import { http, HttpResponse } from "msw";
export const capturedMessageApi = {
    privateList: null,
    privateSend: null,
    groupList: null,
    groupSend: null,
};
export function resetMessageApiCaptures() {
    capturedMessageApi.privateList = null;
    capturedMessageApi.privateSend = null;
    capturedMessageApi.groupList = null;
    capturedMessageApi.groupSend = null;
}
function fakeDialogMessage(chatId, suffix = "") {
    return {
        id: `msg-${chatId}${suffix}`,
        chat_id: chatId,
        owner_id: "user-1",
        encrypted_message: "ZW5jcnlwdGVkLWJsb2I=",
        signature: "c2lnbmF0dXJlLWJsb2I=",
        creation_datetime: "2026-09-08T00:00:00Z",
    };
}
export const handlers = [
    http.post("http://localhost:8000/auth/login", async ({ request }) => {
        const body = (await request.json());
        if (body.username === "test@example.com" && body.password === "correct") {
            const token = {
                access_token: "test-token",
                token_type: "bearer",
            };
            return HttpResponse.json(token);
        }
        const err = { detail: "Invalid credentials" };
        return HttpResponse.json(err, { status: 401 });
    }),
    http.post("http://localhost:8000/auth/login", async ({ request }) => {
        const contentType = request.headers.get("Content-Type") ?? "";
        if (!contentType.includes("application/x-www-form-urlencoded")) {
            const err = { detail: "Expected form-encoded body" };
            return HttpResponse.json(err, { status: 415 });
        }
        const text = await request.text();
        const params = new URLSearchParams(text);
        const username = params.get("username") ?? "";
        const password = params.get("password") ?? "";
        if (username === "test@example.com" && password === "correct") {
            const token = {
                access_token: "fresh-token",
                token_type: "bearer",
            };
            return HttpResponse.json(token);
        }
        const err = { detail: "Invalid credentials" };
        return HttpResponse.json(err, { status: 401 });
    }),
    http.post("http://localhost:8000/auth/register", async ({ request }) => {
        const body = (await request.json());
        if (typeof body.email !== "string" || body.email.length === 0) {
            const err = { detail: "email required" };
            return HttpResponse.json(err, { status: 422 });
        }
        const resp = {
            id: "user-new",
            email: body.email,
        };
        return HttpResponse.json(resp, { status: 201 });
    }),
    http.post("http://localhost:8000/auth/change-public-key", async ({ request }) => {
        const contentType = request.headers.get("Content-Type") ?? "";
        if (!contentType.includes("multipart/form-data")) {
            const err = { detail: "Expected multipart body" };
            return HttpResponse.json(err, { status: 415 });
        }
        const form = await request.formData();
        const file = form.get("new_public_key");
        if (!(file instanceof File)) {
            const err = { detail: "new_public_key missing" };
            return HttpResponse.json(err, { status: 422 });
        }
        const user = {
            id: "user-1",
            email: "test@example.com",
        };
        return HttpResponse.json(user);
    }),
    http.get("http://localhost:8000/users/me", ({ request }) => {
        const auth = request.headers.get("Authorization");
        if (auth === "Bearer test-token" || auth === "Bearer fresh-token") {
            const user = { id: "user-1", email: "test@example.com" };
            return HttpResponse.json(user);
        }
        const err = { detail: "Unauthorized" };
        return HttpResponse.json(err, { status: 401 });
    }),
    http.post("http://localhost:8000/messages/private-chat/", async ({ request }) => {
        const auth = request.headers.get("Authorization");
        if (auth !== "Bearer test-token") {
            const err = { detail: "Unauthorized" };
            return HttpResponse.json(err, { status: 401 });
        }
        const body = (await request.json());
        if (!body.user) {
            const err = { detail: "Missing user" };
            return HttpResponse.json(err, { status: 422 });
        }
        const chat = {
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
            const err = { detail: "Unauthorized" };
            return HttpResponse.json(err, { status: 401 });
        }
        const url = new URL(request.url);
        const lastId = url.searchParams.get("last_id");
        const pageSize = Number(url.searchParams.get("page_size") ?? "50");
        const items = lastId
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
        const resp = {
            page_size: pageSize,
            count_pages: 1,
            items,
            last_id: null,
        };
        return HttpResponse.json(resp);
    }),
    http.get("http://localhost:8000/messages/private-chat/:chatId", ({ params }) => {
        const id = params["chatId"];
        const chat = {
            id: typeof id === "string" ? id : "chat-1",
            name: "single",
            user0: "user-1",
            user1: "user-2",
            create_at: "2026-09-08T00:00:00Z",
        };
        return HttpResponse.json(chat);
    }),
    http.delete("http://localhost:8000/messages/private-chat/:chatId/", ({ params }) => {
        const id = params["chatId"];
        const chat = {
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
            const err = { detail: "Unauthorized" };
            return HttpResponse.json(err, { status: 401 });
        }
        const url = new URL(request.url);
        const lastId = url.searchParams.get("last_id");
        const pageSize = Number(url.searchParams.get("page_size") ?? "50");
        const items = lastId
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
        const resp = {
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
            const err = { detail: "Unauthorized" };
            return HttpResponse.json(err, { status: 401 });
        }
        const body = (await request.json());
        if (!body.public_key) {
            const err = { detail: "public_key required" };
            return HttpResponse.json(err, { status: 422 });
        }
        const chat = {
            id: "group-new",
            name: body.name,
            public_key: body.public_key,
            create_at: "2026-09-08T00:00:00Z",
        };
        return HttpResponse.json(chat);
    }),
    http.get("http://localhost:8000/event/dialogs/", () => {
        const resp = {
            items: [
                { id: "evt-1", chat_id: "chat-1", user_id: "user-2", count: 3 },
                { id: "evt-2", chat_id: "chat-3", user_id: "user-3", count: 1 },
            ],
        };
        return HttpResponse.json(resp);
    }),
    http.get("http://localhost:8000/event/groups/", () => {
        const resp = {
            items: [{ id: "grp-evt-1", chat_id: "group-1", user_id: "user-2", count: 7 }],
        };
        return HttpResponse.json(resp);
    }),
    http.post("http://localhost:8000/event/dialog/readed/:eventId", async ({ params, request }) => {
        const text = await request.text();
        return new HttpResponse(text.length === 0 ? "" : text, {
            status: 200,
            headers: { "Content-Type": "text/html" },
        });
    }),
    http.post("http://localhost:8000/event/group/readed/:eventId", async ({ params, request }) => {
        const text = await request.text();
        return new HttpResponse(text.length === 0 ? "" : text, {
            status: 200,
            headers: { "Content-Type": "text/html" },
        });
    }),
    http.get("http://localhost:8000/messages/private-messages/:chatId", async ({ request, params }) => {
        capturedMessageApi.privateList = {
            method: request.method,
            url: request.url,
            body: await request.text().catch(() => null),
            query: new URL(request.url).searchParams,
        };
        const chatId = typeof params["chatId"] === "string" ? params["chatId"] : "chat";
        const resp = { items: [fakeDialogMessage(chatId)] };
        return HttpResponse.json(resp);
    }),
    http.post("http://localhost:8000/messages/private-message/:chatId", async ({ request, params }) => {
        const raw = await request.text();
        let parsed = raw;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            parsed = raw;
        }
        capturedMessageApi.privateSend = {
            method: request.method,
            url: request.url,
            body: parsed,
            query: new URL(request.url).searchParams,
        };
        const chatId = typeof params["chatId"] === "string" ? params["chatId"] : "chat";
        return HttpResponse.json(fakeDialogMessage(chatId));
    }),
    http.get("http://localhost:8000/group-messages/group-message/:chatId", async ({ request, params }) => {
        capturedMessageApi.groupList = {
            method: request.method,
            url: request.url,
            body: await request.text().catch(() => null),
            query: new URL(request.url).searchParams,
        };
        const chatId = typeof params["chatId"] === "string" ? params["chatId"] : "group";
        const resp = { items: [fakeDialogMessage(chatId)] };
        return HttpResponse.json(resp);
    }),
    http.post("http://localhost:8000/group-messages/group-message/:chatId", async ({ request, params }) => {
        const raw = await request.text();
        let parsed = raw;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            parsed = raw;
        }
        capturedMessageApi.groupSend = {
            method: request.method,
            url: request.url,
            body: parsed,
            query: new URL(request.url).searchParams,
        };
        const chatId = typeof params["chatId"] === "string" ? params["chatId"] : "group";
        return HttpResponse.json(fakeDialogMessage(chatId));
    }),
];
