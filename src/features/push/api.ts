import { apiClient } from "@/infra/apiClient";

export interface PushSubscribeResponse {
  endpoint: string;
}

// re-export so push/subscription.ts keeps working unchanged; /meta now lives in features/meta
export { getMeta } from "@/features/meta/api";
export type { ServerMeta as PushMeta } from "@/features/meta/api";

/**
 * Backend push contract (see server/docs/notifications.md, Web Push):
 * - `POST /push/subscribe` (auth) → upsert, 201 new / 200 refreshed.
 * - `DELETE /push/unsubscribe` (auth) → idempotent, always 204.
 */

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
