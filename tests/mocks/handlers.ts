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

interface GroupChatResponse {
  id: string;
  name: string;
  public_key: string;
  create_at: string;
}

interface PaginatedChatsResponse {
  page_size: number;
  count_pages: number;
  items: PrivateChatResponse[] | GroupChatResponse[];
  last_id: string | null;
}

interface CreateGroupChatRequestBody {
  name: string;
  public_key: string;
}

interface DialogEventResponse {
  id: string;
  chat_id: string;
  user_id: string;
  count: number;
}

interface GroupEventResponse {
  id: string;
  chat_id: string;
  user_id: string;
  count: number;
}

interface ListEventsResponse {
  items: DialogEventResponse[] | GroupEventResponse[];
}

interface DialogMessageResponse {
  id: string;
  chat_id: string;
  owner_id: string;
  encrypted_message: string;
  signature: string;
  creation_datetime: string;
}

interface ListMessagesResponse {
  items: DialogMessageResponse[];
}

interface CreateMessageRequestBody {
  encrypted_message: string;
  signature: string;
  encrypted_message_self: string;
  signature_self: string;
  media_ids?: string[];
}

/**
 * Mirror the backend: the POST response carries the sender's
 * self-copy (the row the sender's UI can decrypt). Requires both
 * pairs, otherwise 422 like the real API.
 */
function fakeSentMessage(chatId: string, body: CreateMessageRequestBody): DialogMessageResponse {
  const base = fakeDialogMessage(chatId);
  return {
    ...base,
    encrypted_message: body.encrypted_message_self,
    signature: body.signature_self,
  };
}

function hasSelfCopy(body: CreateMessageRequestBody): boolean {
  return (
    typeof body.encrypted_message_self === "string" &&
    body.encrypted_message_self.length > 0 &&
    typeof body.signature_self === "string" &&
    body.signature_self.length > 0
  );
}

export interface CapturedMessageApiRequest {
  method: string;
  url: string;
  body: unknown;
  query: URLSearchParams;
}

export const capturedMessageApi: {
  privateList: CapturedMessageApiRequest | null;
  privateSend: CapturedMessageApiRequest | null;
  groupList: CapturedMessageApiRequest | null;
  groupSend: CapturedMessageApiRequest | null;
} = {
  privateList: null,
  privateSend: null,
  groupList: null,
  groupSend: null,
};

export function resetMessageApiCaptures(): void {
  capturedMessageApi.privateList = null;
  capturedMessageApi.privateSend = null;
  capturedMessageApi.groupList = null;
  capturedMessageApi.groupSend = null;
}

function fakeDialogMessage(chatId: string, suffix = ""): DialogMessageResponse {
  return {
    id: `msg-${chatId}${suffix}`,
    chat_id: chatId,
    owner_id: "user-1",
    encrypted_message: "ZW5jcnlwdGVkLWJsb2I=",
    signature: "c2lnbmF0dXJlLWJsb2I=",
    creation_datetime: "2026-09-08T00:00:00Z",
  };
}

interface ErrorBody {
  detail: string;
}

interface RegisterRequestBody {
  email: string;
  password: string;
}

interface RegisterResponseBody {
  id: string;
  email: string;
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

  http.post("http://localhost:8000/auth/login", async ({ request }) => {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!contentType.includes("application/x-www-form-urlencoded")) {
      const err: ErrorBody = { detail: "Expected form-encoded body" };
      return HttpResponse.json(err, { status: 415 });
    }
    const text = await request.text();
    const params = new URLSearchParams(text);
    const username = params.get("username") ?? "";
    const password = params.get("password") ?? "";
    if (username === "test@example.com" && password === "correct") {
      const token: TokenResponse = {
        access_token: "fresh-token",
        token_type: "bearer",
      };
      return HttpResponse.json(token);
    }
    const err: ErrorBody = { detail: "Invalid credentials" };
    return HttpResponse.json(err, { status: 401 });
  }),

  http.post("http://localhost:8000/auth/register", async ({ request }) => {
    const body = (await request.json()) as RegisterRequestBody;
    if (typeof body.email !== "string" || body.email.length === 0) {
      const err: ErrorBody = { detail: "email required" };
      return HttpResponse.json(err, { status: 422 });
    }
    const resp: RegisterResponseBody = {
      id: "user-new",
      email: body.email,
    };
    return HttpResponse.json(resp, { status: 201 });
  }),

  http.post("http://localhost:8000/auth/change-public-key", async ({ request }) => {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      const err: ErrorBody = { detail: "Expected multipart body" };
      return HttpResponse.json(err, { status: 415 });
    }
    const form = await request.formData();
    const file = form.get("new_public_key");
    if (!(file instanceof File)) {
      const err: ErrorBody = { detail: "new_public_key missing" };
      return HttpResponse.json(err, { status: 422 });
    }
    const user: UserResponse = {
      id: "user-1",
      email: "test@example.com",
    };
    return HttpResponse.json(user);
  }),

  http.get("http://localhost:8000/users/me", ({ request }) => {
    const auth = request.headers.get("Authorization");
    if (auth === "Bearer test-token" || auth === "Bearer fresh-token") {
      const user: UserResponse = { id: "user-1", email: "test@example.com" };
      return HttpResponse.json(user);
    }
    const err: ErrorBody = { detail: "Unauthorized" };
    return HttpResponse.json(err, { status: 401 });
  }),

  // Mirrors the real backend: `public_key` is base64 of the
  // ASCII-armored key bytes (FastAPI jsonable_encoder over `bytes`).
  http.get("http://localhost:8000/users/:userId/public-key", ({ params }) => {
    const userId = typeof params.userId === "string" ? params.userId : "user-2";
    if (userId === "user-nokey") {
      return HttpResponse.json({
        user_id: userId,
        has_public_key: false,
        public_key: null,
      });
    }
    // Drifted deployment shape (observed live): raw armor text instead
    // of base64 — the client must accept it as-is, not atob() it.
    if (userId === "user-raw-armor") {
      return HttpResponse.json({
        user_id: userId,
        has_public_key: true,
        public_key:
          "-----BEGIN PGP PUBLIC KEY BLOCK-----\nRawArmorBody\n-----END PGP PUBLIC KEY BLOCK-----\n",
      });
    }
    const armored =
      "-----BEGIN PGP PUBLIC KEY BLOCK-----\nZmFrZS1rZXktYmxvYg==\n-----END PGP PUBLIC KEY BLOCK-----\n";
    let binary = "";
    const bytes = new TextEncoder().encode(armored);
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return HttpResponse.json({
      user_id: userId,
      has_public_key: true,
      public_key: btoa(binary),
    });
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

  http.get("http://localhost:8000/messages/private-chats/", ({ request }) => {
    const auth = request.headers.get("Authorization");
    if (auth !== "Bearer test-token") {
      const err: ErrorBody = { detail: "Unauthorized" };
      return HttpResponse.json(err, { status: 401 });
    }
    const url = new URL(request.url);
    const lastId = url.searchParams.get("last_id");
    const pageSize = Number(url.searchParams.get("page_size") ?? "50");
    const items: PrivateChatResponse[] = lastId
      ? [
          {
            id: "chat-2",
            name: "after",
            user0: "user-1",
            user1: "user-2",
            create_at: "2026-09-08T00:00:00Z",
          },
        ]
      : [
          {
            id: "chat-1",
            name: "first",
            user0: "user-1",
            user1: "user-2",
            create_at: "2026-09-08T00:00:00Z",
          },
        ];
    const resp: PaginatedChatsResponse = {
      page_size: pageSize,
      count_pages: 1,
      items,
      last_id: null,
    };
    return HttpResponse.json(resp);
  }),

  http.get("http://localhost:8000/messages/private-chat/:chatId", ({ params }) => {
    const id = params.chatId;
    const chat: PrivateChatResponse = {
      id: typeof id === "string" ? id : "chat-1",
      name: "single",
      user0: "user-1",
      user1: "user-2",
      create_at: "2026-09-08T00:00:00Z",
    };
    return HttpResponse.json(chat);
  }),

  http.delete("http://localhost:8000/messages/private-chat/:chatId/", ({ params }) => {
    const id = params.chatId;
    const chat: PrivateChatResponse = {
      id: typeof id === "string" ? id : "chat-1",
      name: "deleted",
      user0: "user-1",
      user1: "user-2",
      create_at: "2026-09-08T00:00:00Z",
    };
    return HttpResponse.json(chat);
  }),

  http.get("http://localhost:8000/group-messages/group-chats/", ({ request }) => {
    const auth = request.headers.get("Authorization");
    if (auth !== "Bearer test-token") {
      const err: ErrorBody = { detail: "Unauthorized" };
      return HttpResponse.json(err, { status: 401 });
    }
    const url = new URL(request.url);
    const lastId = url.searchParams.get("last_id");
    const pageSize = Number(url.searchParams.get("page_size") ?? "50");
    const items: GroupChatResponse[] = lastId
      ? [
          {
            id: "group-2",
            name: "after-group",
            public_key: "BASE64KEY2",
            create_at: "2026-09-08T00:00:00Z",
          },
        ]
      : [
          {
            id: "group-1",
            name: "first-group",
            public_key: "BASE64KEY1",
            create_at: "2026-09-08T00:00:00Z",
          },
        ];
    const resp: PaginatedChatsResponse = {
      page_size: pageSize,
      count_pages: 1,
      items,
      last_id: null,
    };
    return HttpResponse.json(resp);
  }),

  http.post("http://localhost:8000/group-messages/group-chat/", async ({ request }) => {
    const auth = request.headers.get("Authorization");
    if (auth !== "Bearer test-token") {
      const err: ErrorBody = { detail: "Unauthorized" };
      return HttpResponse.json(err, { status: 401 });
    }
    const body = (await request.json()) as CreateGroupChatRequestBody;
    if (!body.public_key) {
      const err: ErrorBody = { detail: "public_key required" };
      return HttpResponse.json(err, { status: 422 });
    }
    const chat: GroupChatResponse = {
      id: "group-new",
      name: body.name,
      public_key: body.public_key,
      create_at: "2026-09-08T00:00:00Z",
    };
    return HttpResponse.json(chat);
  }),

  http.get("http://localhost:8000/event/dialogs/", () => {
    const resp: ListEventsResponse = {
      items: [
        { id: "evt-1", chat_id: "chat-1", user_id: "user-2", count: 3 },
        { id: "evt-2", chat_id: "chat-3", user_id: "user-3", count: 1 },
      ],
    };
    return HttpResponse.json(resp);
  }),

  http.get("http://localhost:8000/event/groups/", () => {
    const resp: ListEventsResponse = {
      items: [{ id: "grp-evt-1", chat_id: "group-1", user_id: "user-2", count: 7 }],
    };
    return HttpResponse.json(resp);
  }),

  http.post("http://localhost:8000/event/dialog/readed/:eventId", async ({ request }) => {
    const text = await request.text();
    return new HttpResponse(text.length === 0 ? "" : text, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  }),

  http.post("http://localhost:8000/event/group/readed/:eventId", async ({ request }) => {
    const text = await request.text();
    return new HttpResponse(text.length === 0 ? "" : text, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  }),

  http.get(
    "http://localhost:8000/messages/private-messages/:chatId",
    async ({ request, params }) => {
      capturedMessageApi.privateList = {
        method: request.method,
        url: request.url,
        body: await request.text().catch(() => null),
        query: new URL(request.url).searchParams,
      };
      const chatId = typeof params.chatId === "string" ? params.chatId : "chat";
      const resp: ListMessagesResponse = { items: [fakeDialogMessage(chatId)] };
      return HttpResponse.json(resp);
    },
  ),

  http.post(
    "http://localhost:8000/messages/private-message/:chatId",
    async ({ request, params }) => {
      const raw = await request.text();
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw) as CreateMessageRequestBody;
      } catch {
        parsed = raw;
      }
      capturedMessageApi.privateSend = {
        method: request.method,
        url: request.url,
        body: parsed,
        query: new URL(request.url).searchParams,
      };
      const chatId = typeof params.chatId === "string" ? params.chatId : "chat";
      const body = parsed as CreateMessageRequestBody;
      if (typeof body !== "object" || body === null || !hasSelfCopy(body)) {
        return HttpResponse.json({ detail: "self-copy required" }, { status: 422 });
      }
      return HttpResponse.json(fakeSentMessage(chatId, body));
    },
  ),

  http.get(
    "http://localhost:8000/group-messages/group-message/:chatId",
    async ({ request, params }) => {
      capturedMessageApi.groupList = {
        method: request.method,
        url: request.url,
        body: await request.text().catch(() => null),
        query: new URL(request.url).searchParams,
      };
      const chatId = typeof params.chatId === "string" ? params.chatId : "group";
      const resp: ListMessagesResponse = { items: [fakeDialogMessage(chatId)] };
      return HttpResponse.json(resp);
    },
  ),

  http.post(
    "http://localhost:8000/group-messages/group-message/:chatId",
    async ({ request, params }) => {
      const raw = await request.text();
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw) as CreateMessageRequestBody;
      } catch {
        parsed = raw;
      }
      capturedMessageApi.groupSend = {
        method: request.method,
        url: request.url,
        body: parsed,
        query: new URL(request.url).searchParams,
      };
      const chatId = typeof params.chatId === "string" ? params.chatId : "group";
      const body = parsed as CreateMessageRequestBody;
      if (typeof body !== "object" || body === null || !hasSelfCopy(body)) {
        return HttpResponse.json({ detail: "self-copy required" }, { status: 422 });
      }
      return HttpResponse.json(fakeSentMessage(chatId, body));
    },
  ),
];
