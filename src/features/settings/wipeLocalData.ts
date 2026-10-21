/**
 * Полный сброс локальных данных устройства для пользователя:
 * переписки (.qdlog), медиа-vault (.qmed + индексы) и keystore-файл
 * (`<userId>.qks` + запись в index.json). После этого потребуется
 * повторный вход/регистрация.
 */

import { clearDialogs } from "@/features/dialog-store/store";
import { deleteKeystoreForUser } from "@/features/keyring/generate";
import { clearMediaVault } from "@/features/media/vault";

/** Count of wiped conversations and vault entries (keystore is not counted). */
export interface WipeDeviceDataResult {
  dialogs: number;
  media: number;
}

/**
 * Full local data reset for a user: conversations (`.qdlog`), the media
 * vault (`.qmed` + indexes) and the keystore file (`<userId>.qks` +
 * its `index.json` row). After this the user must log in again or
 * register anew.
 *
 * Best-effort ordering: dialogs first, then media, then the keystore.
 * Only a keystore failure is swallowed (it must not mask the
 * already-deleted data); rejections from the first two collaborators
 * propagate — they never throw in normal operation.
 */
export async function wipeDeviceData(userId: string): Promise<WipeDeviceDataResult> {
  const dialogs = await clearDialogs(userId);
  const media = await clearMediaVault(userId);
  try {
    await deleteKeystoreForUser(userId);
  } catch {
    // best-effort — proceed even if the keystore file is already gone
  }
  return { dialogs, media };
}
