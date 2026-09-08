export interface ApiErrorBody {
  detail: string | { msg: string; loc?: string[] }[];
}

export interface RequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
