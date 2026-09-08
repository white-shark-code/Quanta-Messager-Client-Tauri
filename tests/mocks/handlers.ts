import { http, HttpResponse } from "msw";

interface LoginRequestBody {
  username: string;
  password: string;
}

interface PrivateChatRequestBody {
  name: string;
  user: string;
}

interface UserResponse {
  id: string;
  email: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
}

interface PrivateChatResponse {
  id: string;
  name: string;
  user0: string;
  user1: string;
  create_at: string;
}

interface ErrorBody {
  detail: string;
}

export const handlers = [
  http.post("http://localhost:8000/auth/login", async ({ request }) => {
    const body = (await request.json()) as LoginRequestBody;
    if (body.username === "test@example.com" && body.password === "correct") {
      const token: TokenResponse = {
        access_token: "test-token",
        token_type: "bearer",
      };
      return HttpResponse.json(token);
    }
    const err: ErrorBody = { detail: "Invalid credentials" };
    return HttpResponse.json(err, { status: 401 });
  }),

  http.get("http://localhost:8000/users/me", ({ request }) => {
    const auth = request.headers.get("Authorization");
    if (auth === "Bearer test-token") {
      const user: UserResponse = { id: "user-1", email: "test@example.com" };
      return HttpResponse.json(user);
    }
    const err: ErrorBody = { detail: "Unauthorized" };
    return HttpResponse.json(err, { status: 401 });
  }),

  http.post("http://localhost:8000/messages/private-chat/", async ({ request }) => {
    const auth = request.headers.get("Authorization");
    if (auth !== "Bearer test-token") {
      const err: ErrorBody = { detail: "Unauthorized" };
      return HttpResponse.json(err, { status: 401 });
    }
    const body = (await request.json()) as PrivateChatRequestBody;
    if (!body.user) {
      const err: ErrorBody = { detail: "Missing user" };
      return HttpResponse.json(err, { status: 422 });
    }
    const chat: PrivateChatResponse = {
      id: "chat-1",
      name: body.name,
      user0: "user-1",
      user1: body.user,
      create_at: "2026-09-08T00:00:00Z",
    };
    return HttpResponse.json(chat);
  }),
];
