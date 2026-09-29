import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { changePublicKey, login, logout, me, register } from "@/features/auth/api";
import { configureClient } from "@/infra/apiClient";

import { server } from "../../mocks/server";

const PUBLIC_KEY_FIXTURE =
  "-----BEGIN PGP PUBLIC KEY BLOCK-----\n" +
  "mDMEYJZ2YBYJKwYBBAHaRw8BAQdAfakeArmoredBytesForUnitTestingOnly\n" +
  "=abcd\n" +
  "-----END PGP PUBLIC KEY BLOCK-----\n";

describe("auth/api", () => {
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

  describe("login", () => {
    it("POSTs form-encoded body to /auth/login and returns the bearer token", async () => {
      let capturedUrl: string | null = null;
      let capturedMethod: string | null = null;
      let capturedContentType: string | null = null;
      let capturedRaw: string | null = null;

      server.use(
        http.post("http://localhost:8000/auth/login", async ({ request }) => {
          capturedUrl = request.url;
          capturedMethod = request.method;
          capturedContentType = request.headers.get("Content-Type");
          capturedRaw = await request.text();
          return HttpResponse.json({
            access_token: "fresh-token",
            token_type: "bearer",
          });
        }),
      );

      const res = await login({ username: "alice@example.com", password: "s3cret" });

      expect(capturedUrl).toBe("http://localhost:8000/auth/login");
      expect(capturedMethod).toBe("POST");
      expect(capturedContentType).toBe("application/x-www-form-urlencoded;charset=UTF-8");
      expect(capturedRaw).not.toBeNull();
      const parsed = new URLSearchParams(capturedRaw as unknown as string);
      expect(parsed.get("username")).toBe("alice@example.com");
      expect(parsed.get("password")).toBe("s3cret");

      expect(res).toEqual({ access_token: "fresh-token", token_type: "bearer" });
    });

    it("uses 'username' field (not 'email') per fastapi-users OAuth2 form", async () => {
      let capturedRaw: string | null = null;
      server.use(
        http.post("http://localhost:8000/auth/login", async ({ request }) => {
          capturedRaw = await request.text();
          return HttpResponse.json({
            access_token: "tok",
            token_type: "bearer",
          });
        }),
      );

      await login({ username: "bob@example.com", password: "pw" });

      const parsed = new URLSearchParams(capturedRaw as unknown as string);
      expect(parsed.has("username")).toBe(true);
      expect(parsed.has("email")).toBe(false);
      expect(parsed.get("username")).toBe("bob@example.com");
    });

    it("URL-encodes special characters in the password", async () => {
      let capturedRaw: string | null = null;
      server.use(
        http.post("http://localhost:8000/auth/login", async ({ request }) => {
          capturedRaw = await request.text();
          return HttpResponse.json({
            access_token: "tok",
            token_type: "bearer",
          });
        }),
      );

      await login({ username: "u@e.com", password: "p&w=s p?ace" });

      const parsed = new URLSearchParams(capturedRaw as unknown as string);
      expect(parsed.get("password")).toBe("p&w=s p?ace");
    });

    it("propagates an ApiError when the server rejects the credentials", async () => {
      server.use(
        http.post("http://localhost:8000/auth/login", () =>
          HttpResponse.json({ detail: "Invalid credentials" }, { status: 401 }),
        ),
      );

      await expect(
        login({ username: "wrong@example.com", password: "nope" }),
      ).rejects.toMatchObject({ status: 401, detail: "Invalid credentials" });
    });
  });

  describe("register", () => {
    it("POSTs JSON body to /auth/register and returns the new user", async () => {
      let capturedContentType: string | null = null;
      let capturedRaw: string | null = null;

      server.use(
        http.post("http://localhost:8000/auth/register", async ({ request }) => {
          capturedContentType = request.headers.get("Content-Type");
          capturedRaw = await request.text();
          return HttpResponse.json({ id: "user-new", email: "carol@example.com" }, { status: 201 });
        }),
      );

      const res = await register({ email: "carol@example.com", password: "pw1234" });

      expect(capturedContentType).toBe("application/json");
      expect(capturedRaw).not.toBeNull();
      expect(JSON.parse(capturedRaw as unknown as string)).toEqual({
        email: "carol@example.com",
        password: "pw1234",
      });
      expect(res).toEqual({ id: "user-new", email: "carol@example.com" });
    });
  });

  describe("me", () => {
    it("GETs /users/me and returns the user profile", async () => {
      configureClient({
        tokenProvider: () => "test-token",
        onUnauthorized: () => undefined,
      });

      const res = await me();

      expect(res).toEqual({ id: "user-1", email: "test@example.com" });
    });

    it("attaches Authorization header when a token provider is configured", async () => {
      configureClient({
        tokenProvider: () => "test-token",
        onUnauthorized: () => undefined,
      });

      let capturedAuth: string | null = null;
      server.use(
        http.get("http://localhost:8000/users/me", ({ request }) => {
          capturedAuth = request.headers.get("Authorization");
          return HttpResponse.json({ id: "u", email: "x@y.com" });
        }),
      );

      await me();

      expect(capturedAuth).toBe("Bearer test-token");
    });
  });

  describe("changePublicKey", () => {
    it("POSTs a multipart body to /auth/change-public-key with field 'new_public_key'", async () => {
      let capturedContentType: string | null = null;
      let capturedFieldName: string | null = null;
      let capturedFilename: string | null = null;
      let capturedFileType: string | null = null;
      let capturedBody: string | null = null;

      server.use(
        http.post("http://localhost:8000/auth/change-public-key", async ({ request }) => {
          capturedContentType = request.headers.get("Content-Type");
          const form = await request.formData();
          const entry = form.get("new_public_key");
          if (entry instanceof File) {
            capturedFieldName = "new_public_key";
            capturedFilename = entry.name;
            capturedFileType = entry.type;
            capturedBody = await entry.text();
          } else if (typeof entry === "string") {
            capturedFieldName = "new_public_key";
            capturedBody = entry;
          }
          return HttpResponse.json({ id: "user-1", email: "test@example.com" });
        }),
      );

      const res = await changePublicKey(PUBLIC_KEY_FIXTURE);

      expect(res).toEqual({ id: "user-1", email: "test@example.com" });
      expect(capturedContentType).not.toBeNull();
      expect(capturedContentType).toMatch(/^multipart\/form-data; boundary=/);
      expect(capturedFieldName).toBe("new_public_key");
      expect(capturedFilename).toBe("public_key.asc");
      expect(capturedFileType).toBe("text/plain");
      expect(capturedBody).toBe(PUBLIC_KEY_FIXTURE);
    });
  });

  describe("logout", () => {
    it("POSTs to /auth/logout and resolves without throwing on success", async () => {
      server.use(
        http.post(
          "http://localhost:8000/auth/logout",
          () => new HttpResponse(null, { status: 204 }),
        ),
      );

      await expect(logout()).resolves.toBeUndefined();
    });

    it("does NOT throw when the server rejects the logout request", async () => {
      server.use(
        http.post("http://localhost:8000/auth/logout", () =>
          HttpResponse.json({ detail: "Server-side logout not implemented" }, { status: 501 }),
        ),
      );

      await expect(logout()).resolves.toBeUndefined();
    });

    it("does NOT throw on network-level failure", async () => {
      server.use(http.post("http://localhost:8000/auth/logout", () => HttpResponse.error()));

      await expect(logout()).resolves.toBeUndefined();
    });
  });
});
