export class ApiError extends Error {
    status;
    detail;
    raw;
    constructor(status, detail, raw) {
        super(detail);
        this.name = "ApiError";
        this.status = status;
        this.detail = detail;
        this.raw = raw;
    }
}
export class NetworkError extends Error {
    constructor(message, errCause) {
        super(message, errCause !== undefined ? { cause: errCause } : undefined);
        this.name = "NetworkError";
    }
}
function extractDetail(body) {
    if (typeof body === "string" && body.length > 0) {
        return body;
    }
    if (body !== null && typeof body === "object") {
        const detail = body.detail;
        if (typeof detail === "string" && detail.length > 0) {
            return detail;
        }
        if (Array.isArray(detail)) {
            const parts = [];
            for (const item of detail) {
                if (item !== null && typeof item === "object") {
                    const entry = item;
                    const loc = entry.loc;
                    const where = Array.isArray(loc) && loc.length > 0
                        ? loc.map((segment) => String(segment)).join(".")
                        : "<root>";
                    const msg = typeof entry.msg === "string" ? entry.msg : String(item);
                    parts.push(`${where}: ${msg}`);
                }
                else {
                    parts.push(String(item));
                }
            }
            if (parts.length > 0) {
                return parts.join("; ");
            }
        }
    }
    return "Ошибка запроса";
}
export function normalizeApiError(status, body) {
    return new ApiError(status, extractDetail(body), body);
}
export const ERROR_MAPPINGS = {
    400: {
        category: "validation",
        userMessage: "Невалидный запрос",
        shouldRetry: false,
        shouldLogout: false,
    },
    401: {
        category: "auth",
        userMessage: "Сессия истекла, войдите снова",
        shouldRetry: false,
        shouldLogout: true,
    },
    403: {
        category: "permission",
        userMessage: "Нет доступа",
        shouldRetry: false,
        shouldLogout: false,
    },
    404: {
        category: "notfound",
        userMessage: "Не найдено",
        shouldRetry: false,
        shouldLogout: false,
    },
    405: {
        category: "client",
        userMessage: "Сначала добавьте публичный ключ в настройках",
        shouldRetry: false,
        shouldLogout: false,
    },
    413: {
        category: "validation",
        userMessage: "Файл слишком большой (макс. 50 МБ)",
        shouldRetry: false,
        shouldLogout: false,
    },
    422: {
        category: "validation",
        userMessage: "Невалидные данные или подпись",
        shouldRetry: false,
        shouldLogout: false,
    },
    500: {
        category: "server",
        userMessage: "Ошибка сервера, попробуйте позже",
        shouldRetry: true,
        shouldLogout: false,
    },
};
const FALLBACK_MAPPING = {
    category: "unknown",
    userMessage: "Неизвестная ошибка",
    shouldRetry: false,
    shouldLogout: false,
};
export function getErrorMapping(status) {
    return ERROR_MAPPINGS[status] ?? FALLBACK_MAPPING;
}
export function toUserMessage(err) {
    // ApiError → mapped status message OR detail
    if (err instanceof ApiError) {
        return ERROR_MAPPINGS[err.status]?.userMessage ?? err.detail;
    }
    // NetworkError → "Нет связи с сервером"
    if (err instanceof NetworkError) {
        return "Нет связи с сервером";
    }
    // Error → message
    if (err instanceof Error) {
        return err.message;
    }
    // String
    if (typeof err === "string" && err.length > 0) {
        return err;
    }
    // null / undefined
    if (err === null)
        return "Неизвестная ошибка (null)";
    if (err === undefined)
        return "Неизвестная ошибка (undefined)";
    // Object — try to extract message field, then JSON-stringify (truncated)
    if (typeof err === "object") {
        const e = err;
        if (typeof e.message === "string" && e.message.length > 0)
            return e.message;
        if (typeof e.reason === "string" && e.reason.length > 0)
            return e.reason;
        if (typeof e.detail === "string" && e.detail.length > 0)
            return e.detail;
        try {
            const j = JSON.stringify(err);
            return j.length > 200 ? j.slice(0, 200) + "…" : j;
        }
        catch {
            // fall through
        }
    }
    return "Неизвестная ошибка";
}
export function shouldLogout(err) {
    if (err instanceof ApiError) {
        return getErrorMapping(err.status).shouldLogout;
    }
    return false;
}
