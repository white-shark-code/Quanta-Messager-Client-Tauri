import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient, configureClient } from "@/infra/apiClient";
import { ApiError, NetworkError } from "@/infra/error";

import { server } from "../../mocks/server";

describe("apiClient", () => {
  beforeEach(() => {
    configureClient({
      tokenProvider: () => null,
      onUnauthorized: () => undefined,
    });
  });

  afterEach(() => {
    configureClient({
      tokenProvider: () => null,
      onUnauthorized: () => undefined,
    });
    vi.restoreAllMocks();
  });

  it("configureClient sets the tokenProvider used by subsequent requests", async () => {
    configureClient({
      tokenProvider: () => "configured-token",
      onUnauthorized: () => undefined,
    });

    let captured: string | null = null;
    server.use(
      http.get("http://localhost:8000/probe", ({ request }) => {
        captured = request.headers.get("Authorization");
        return HttpResponse.json({ ok: true });
      }),
    );

    await apiClient.get<{ ok: true }>("/probe");

    expect(captured).toBe("Bearer configured-token");
  });

  it("apiClient.get sends Authorization header when token is provided", async () => {
    configureClient({
      tokenProvider: () => "test-token",
      onUnauthorized: () => undefined,
    });

    const me = await apiClient.get<{ id: string; email: string }>("/users/me");

    expect(me).toEqual({ id: "user-1", email: "test@example.com" });
  });

  it("apiClient.get omits Authorization header when token is null", async () => {
    let capturedAuth: string | null = "sentinel";
    server.use(
      http.get("http://localhost:8000/probe-no-auth", ({ request }) => {
        capturedAuth = request.headers.get("Authorization");
        return HttpResponse.json({ ok: true });
      }),
    );

    await apiClient.get<{ ok: true }>("/probe-no-auth");

    expect(capturedAuth).toBeNull();
  });

  it("apiClient.get throws ApiError with status 401 on unauthorized responses", async () => {
    await expect(apiClient.get("/users/me")).rejects.toBeInstanceOf(ApiError);

    try {
      await apiClient.get("/users/me");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(401);
      expect(apiErr.detail).toBe("Unauthorized");
    }
  });

  it("apiClient triggers onUnauthorized callback on 401 responses", async () => {
    const onUnauthorized = vi.fn();
    configureClient({
      tokenProvider: () => "wrong-token",
      onUnauthorized,
    });

    await expect(apiClient.get("/users/me")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("apiClient.post sends JSON body with Content-Type and parses JSON response", async () => {
    configureClient({
      tokenProvider: () => "test-token",
      onUnauthorized: () => undefined,
    });

    let capturedContentType: string | null = null;
    let capturedRaw: string | null = null;
    server.use(
      http.post("http://localhost:8000/echo", async ({ request }) => {
        capturedContentType = request.headers.get("Content-Type");
        capturedRaw = await request.text();
        return HttpResponse.json({ echoed: true });
      }),
    );

    const result = await apiClient.post<{ echoed: true }>("/echo", { hello: "world", n: 42 });

    expect(result).toEqual({ echoed: true });
    expect(capturedContentType).toBe("application/json");
    expect(capturedRaw).not.toBeNull();
    const parsed = JSON.parse(capturedRaw as unknown as string) as { hello: string; n: number };
    expect(parsed).toEqual({ hello: "world", n: 42 });
  });

  it("apiClient.delete sends DELETE method and parses JSON response", async () => {
    configureClient({
      tokenProvider: () => "test-token",
      onUnauthorized: () => undefined,
    });

    let capturedMethod: string | null = null;
    server.use(
      http.delete("http://localhost:8000/items/42", ({ request }) => {
        capturedMethod = request.method;
        return HttpResponse.json({ deleted: true });
      }),
    );

    const result = await apiClient.delete<{ deleted: true }>("/items/42");

    expect(result).toEqual({ deleted: true });
    expect(capturedMethod).toBe("DELETE");
  });

  it("apiClient.delete returns undefined on 204 No Content", async () => {
    server.use(
      http.delete("http://localhost:8000/items/204", () => new HttpResponse(null, { status: 204 })),
    );

    const result = await apiClient.delete<void>("/items/204");
    expect(result).toBeUndefined();
  });

  it("AbortSignal cancels in-flight request", async () => {
    server.use(
      http.get("http://localhost:8000/slow", async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 200);
        });
        return HttpResponse.json({ too: "late" });
      }),
    );

    const controller = new AbortController();
    const promise = apiClient.get<{ too: string }>("/slow", { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("parses FastAPI error format with {detail: string}", async () => {
    server.use(
      http.get("http://localhost:8000/error-string", () =>
        HttpResponse.json({ detail: "Need add public key" }, { status: 405 }),
      ),
    );

    try {
      await apiClient.get("/error-string");
      expect.fail("expected ApiError");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(405);
      expect(apiErr.detail).toBe("Need add public key");
    }
  });

  it("parses FastAPI error format with {detail: array} of validation items", async () => {
    const validationDetail = [
      { loc: ["body", "user"], msg: "field required", type: "value_error.missing" },
      { loc: ["body", "name"], msg: "must be string", type: "type_error" },
    ];
    server.use(
      http.post("http://localhost:8000/error-array", () =>
        HttpResponse.json({ detail: validationDetail }, { status: 422 }),
      ),
    );

    try {
      await apiClient.post("/error-array", { foo: "bar" });
      expect.fail("expected ApiError");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(422);
      expect(apiErr.detail).toContain("body.user: field required");
      expect(apiErr.detail).toContain("body.name: must be string");
    }
  });

  it("uses custom Content-Type header from RequestOptions when provided", async () => {
    let capturedContentType: string | null = null;
    server.use(
      http.post("http://localhost:8000/custom-ct", ({ request }) => {
        capturedContentType = request.headers.get("Content-Type");
        return HttpResponse.json({ ok: true });
      }),
    );

    await apiClient.post(
      "/custom-ct",
      { foo: "bar" },
      { headers: { "Content-Type": "application/x-custom" } },
    );

    expect(capturedContentType).toBe("application/x-custom");
  });

  it("encodes Uint8Array fields as base64 inside JSON body and round-trips them", async () => {
    configureClient({
      tokenProvider: () => "test-token",
      onUnauthorized: () => undefined,
    });

    const original = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
    const expectedBase64 = Buffer.from(original).toString("base64");

    let capturedRaw: string | null = null;
    server.use(
      http.post("http://localhost:8000/binary-echo", async ({ request }) => {
        capturedRaw = await request.text();
        const parsed = JSON.parse(capturedRaw) as { blob: string };
        const recovered = new Uint8Array(Buffer.from(parsed.blob, "base64"));
        return HttpResponse.json({ blob: Array.from(recovered), originalSize: parsed.blob.length });
      }),
    );

    interface EchoResp {
      blob: number[];
      originalSize: number;
    }
    const result = await apiClient.post<EchoResp>("/binary-echo", {
      blob: original,
      label: "test",
    });

    expect(capturedRaw).not.toBeNull();
    const parsedSent = JSON.parse(capturedRaw as unknown as string) as {
      blob: string;
      label: string;
    };
    expect(parsedSent.blob).toBe(expectedBase64);
    expect(parsedSent.label).toBe("test");

    expect(result.blob).toEqual(Array.from(original));
    expect(result.originalSize).toBe(expectedBase64.length);
  });

  it("encodes a large Uint8Array via chunked base64 conversion (>= 0x8000 bytes)", async () => {
    configureClient({
      tokenProvider: () => "test-token",
      onUnauthorized: () => undefined,
    });

    const big = new Uint8Array(0x8000 + 17);
    for (let i = 0; i < big.length; i++) {
      big[i] = i & 0xff;
    }
    const expectedBase64 = Buffer.from(big).toString("base64");

    let capturedRaw: string | null = null;
    server.use(
      http.post("http://localhost:8000/binary-big", async ({ request }) => {
        capturedRaw = await request.text();
        const parsed = JSON.parse(capturedRaw) as { blob: string };
        const recovered = new Uint8Array(Buffer.from(parsed.blob, "base64"));
        return HttpResponse.json({ size: recovered.length });
      }),
    );

    interface Resp {
      size: number;
    }
    const result = await apiClient.post<Resp>("/binary-big", { blob: big });

    expect(capturedRaw).not.toBeNull();
    const parsedSent = JSON.parse(capturedRaw as unknown as string) as { blob: string };
    expect(parsedSent.blob).toBe(expectedBase64);
    expect(result.size).toBe(big.length);
  });

  it("throws NetworkError when fetch fails (server closed)", async () => {
    server.close();

    try {
      await apiClient.get("/users/me");
      expect.fail("expected NetworkError");
    } catch (err) {
      expect(err).toBeInstanceOf(NetworkError);
    } finally {
      server.listen({ onUnhandledRequest: "error" });
    }
  });
});
