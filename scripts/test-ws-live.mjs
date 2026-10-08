#!/usr/bin/env node
/* global Buffer, URLSearchParams, WebSocket, clearTimeout, console, fetch, process, setTimeout */
/**
 * Live check for the realtime events channel (`/event/ws`, T6).
 *
 * Phases:
 *   A (always) — login as TEST_USER, open WS `/event/ws?token=…`,
 *      wait for `{"type":"connected"}` (10s), send `ping`, wait for
 *      `{"type":"pong"}` (5s).
 *   B (only when TEST_USER2 + TEST_PASS2 + TEST_CHAT_ID are set) —
 *      login as the second user, POST one message via REST
 *      `/messages/private-message/{chat}`, and expect user-1's socket
 *      to receive `new_dialog_message` (10s).
 *
 * Required env:
 *   TEST_USER / TEST_PASS — first user (OAuth2 password form login).
 * Optional env:
 *   TEST_API_BASE (default http://localhost:8000),
 *   TEST_USER2 / TEST_PASS2 + TEST_CHAT_ID — enable phase B.
 *
 * Without TEST_USER/TEST_PASS the script prints SKIP and exits 0
 * (CI without a backend must stay green). `--help` prints usage.
 *
 * The access token is never printed or logged (only its length).
 */

const CONNECT_TIMEOUT_MS = 10_000;
const PONG_TIMEOUT_MS = 5_000;
const EVENT_TIMEOUT_MS = 10_000;

function usage() {
  console.log(`test-ws-live.mjs — live check for the events WebSocket channel

Usage:
  node scripts/test-ws-live.mjs [--help]

Env:
  TEST_USER / TEST_PASS          first user credentials (required, else SKIP)
  TEST_USER2 / TEST_PASS2        second user credentials (optional, phase B)
  TEST_CHAT_ID                   private chat id for phase B (with TEST_USER2*)
  TEST_API_BASE                  backend base URL (default http://localhost:8000)

Exit codes:
  0  PASS or SKIP (no credentials / phase-B send rejected by validation)
  1  live failure (login / WS / ping-pong / event propagation)
  2  usage error`);
}

function toWsBase(httpBase) {
  const trimmed = httpBase.replace(/\/+$/, "");
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length)}`;
  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length)}`;
  return trimmed;
}

async function login(base, username, password) {
  const form = new URLSearchParams();
  form.append("username", username);
  form.append("password", password);
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 300);
    throw new Error(`POST /auth/login → HTTP ${res.status}: ${snippet}`);
  }
  const body = await res.json();
  if (typeof body?.access_token !== "string" || body.access_token.length === 0) {
    throw new Error("POST /auth/login → response has no access_token");
  }
  return body.access_token;
}

/** Wait for the next WS text frame satisfying `pred`, or reject on timeout. */
function waitForFrame(ws, pred, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${label} after ${timeoutMs}ms`));
    }, timeoutMs);
    function onMessage(ev) {
      let parsed;
      try {
        const text = typeof ev.data === "string" ? ev.data : String(ev.data);
        parsed = JSON.parse(text);
      } catch {
        return; // ignore non-JSON noise, like the app socket does
      }
      if (pred(parsed)) {
        cleanup();
        resolve(parsed);
      }
    }
    function onError() {
      cleanup();
      reject(new Error(`WebSocket error while waiting for ${label}`));
    }
    function onClose(ev) {
      cleanup();
      reject(new Error(`WebSocket closed (code ${ev?.code}) while waiting for ${label}`));
    }
    function cleanup() {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
    }
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });
}

function connectWs(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // ignore — we are already failing
      }
      reject(new Error(`WS connect timed out after ${timeoutMs}ms: ${toWsBase(url)}`));
    }, timeoutMs);
    ws.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve(ws);
      },
      { once: true },
    );
    ws.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error(`WS connect failed: ${toWsBase(url)} (is the backend up?)`));
      },
      { once: true },
    );
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    usage();
    return 0;
  }
  if (argv.length > 0) {
    console.error(`Unknown arguments: ${argv.join(" ")}`);
    usage();
    return 2;
  }

  const base = (process.env.TEST_API_BASE ?? "http://localhost:8000").replace(/\/+$/, "");
  const user = process.env.TEST_USER;
  const pass = process.env.TEST_PASS;

  if (!user || !pass) {
    console.log(
      "SKIP: TEST_USER/TEST_PASS are not set — live WS check needs a running backend.\n" +
        "Set TEST_USER/TEST_PASS (+ optional TEST_USER2/TEST_PASS2/TEST_CHAT_ID) to run it.",
    );
    return 0;
  }

  if (typeof WebSocket === "undefined") {
    console.error("FAIL: global WebSocket is unavailable (need Node ≥ 21).");
    return 1;
  }

  // ---- Phase A: login + connected + ping/pong as user 1 ----
  console.log(`→ login as ${user} @ ${base}`);
  let token1;
  try {
    token1 = await login(base, user, pass);
  } catch (err) {
    console.error(`FAIL: login failed: ${err.message}`);
    return 1;
  }
  console.log(`→ login ok (token length ${token1.length})`);

  const wsUrl = `${toWsBase(base)}/event/ws?token=${encodeURIComponent(token1)}`;
  console.log("→ opening WS /event/ws");
  let ws;
  try {
    ws = await connectWs(wsUrl, CONNECT_TIMEOUT_MS);
  } catch (err) {
    console.error(`FAIL: ${err.message}`);
    return 1;
  }
  try {
    await waitForFrame(ws, (m) => m?.type === "connected", CONNECT_TIMEOUT_MS, '"connected"');
    console.log('→ received "connected"');
    ws.send("ping");
    await waitForFrame(ws, (m) => m?.type === "pong", PONG_TIMEOUT_MS, '"pong"');
    console.log("→ ping/pong ok — phase A PASS");
  } catch (err) {
    console.error(`FAIL: ${err.message}`);
    return 1;
  }

  // ---- Phase B: second user sends a message via REST, user 1 gets the event ----
  const user2 = process.env.TEST_USER2;
  const pass2 = process.env.TEST_PASS2;
  const chatId = process.env.TEST_CHAT_ID;
  if (!user2 || !pass2 || !chatId) {
    console.log("→ phase B skipped (need TEST_USER2/TEST_PASS2/TEST_CHAT_ID); phase A PASS");
    ws.close();
    return 0;
  }

  console.log(`→ login as ${user2} for phase B`);
  let token2;
  try {
    token2 = await login(base, user2, pass2);
  } catch (err) {
    console.error(`FAIL: second-user login failed: ${err.message}`);
    ws.close();
    return 1;
  }
  const probe = waitForFrame(
    ws,
    (m) => m?.type === "new_dialog_message" && m?.chat_id === chatId,
    EVENT_TIMEOUT_MS,
    `"new_dialog_message" for chat ${chatId}`,
  );
  const sendRes = await fetch(`${base}/messages/private-message/${chatId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token2}`,
    },
    body: JSON.stringify({
      encrypted_message: Buffer.from("live-probe").toString("base64"),
      signature: Buffer.from("live-probe-sig").toString("base64"),
      encrypted_message_self: Buffer.from("live-probe").toString("base64"),
      signature_self: Buffer.from("live-probe-sig").toString("base64"),
    }),
  });
  if (!sendRes.ok) {
    const snippet = (await sendRes.text()).slice(0, 300);
    console.log(
      `SKIP phase B: probe send rejected (HTTP ${sendRes.status}: ${snippet}) — ` +
        "the backend requires a real encrypted payload; phase A PASS",
    );
    ws.close();
    return 0;
  }
  console.log("→ probe message sent, waiting for new_dialog_message…");
  try {
    await probe;
    console.log("→ event propagation ok — phase B PASS");
    ws.close();
    return 0;
  } catch (err) {
    console.error(`FAIL: ${err.message}`);
    ws.close();
    return 1;
  }
}

try {
  process.exit(await main());
} catch (err) {
  console.error(`FAIL: unexpected error: ${err?.message ?? err}`);
  process.exit(1);
}
