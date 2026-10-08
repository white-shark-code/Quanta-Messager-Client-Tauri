import { apiClient } from "@/infra/apiClient";

export interface PushMeta {
  vapid_public_key: string;
}

export interface PushSubscribeResponse {
  endpoint: string;
}

/**
 * Backend push contract (see server/docs/notifications.md, Web Push):
 * - `GET /meta` (no auth) → `{vapid_public_key}`. An empty string means
 *   VAPID is not configured and subscribing is impossible.
 * - `POST /push/subscribe` (auth) → upsert, 201 new / 200 refreshed.
 * - `DELETE /push/unsubscribe` (auth) → idempotent, always 204.
 */
export async function getMeta(): Promise<PushMeta> {
  return apiClient.get<PushMeta>("/meta");
}

export async function subscribePush(
  endpoint: string,
  p256dh: string,
  auth: string,
): Promise<PushSubscribeResponse> {
  return apiClient.post<PushSubscribeResponse>("/push/subscribe", {
    endpoint,
    keys: { p256dh, auth },
  });
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  // apiClient.delete carries no body; request() serializes the JSON body.
  await apiClient.request<void>("DELETE", "/push/unsubscribe", { endpoint });
}
