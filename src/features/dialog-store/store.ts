/**
 * Локальное шифрованное хранилище истории диалогов.
 *
 * На каждый чат — один файл `.qdlog`, путь `<userId>/<chatId>`.
 * Внутри — ChaCha20-Poly1305 блоб (`QDLG1`, см. `secure-store/format.ts`),
 * содержащий JSON-сериализованный `DialogMessage[]` уже известных
 * сообщений чата: как отправленных (после подтверждения сервером), так
 * и полученных (из polling / fetch).
 *
 * Ключ ChaCha20 — случайный 32-байтный блоб, хранится в keystore
 * пользователя как `KeystorePayload.dialogKey`. В памяти лежит только
 * между unlock и lock (`keyringStore.dialogKeyB64`); без него `.qdlog`
 * файлы нечитаемы до следующего unlock.
 *
 * Append-only: перед записью делаем dedupe по `message.id` и сортировку
 * по `creation_datetime`, так что конкурентные append из send-mutation
 * и polling-fetch дают согласованный файл. Удаление из файла —
 * только через явный `deleteDialog` (настройки «стереть все данные»).
 */

import type { DialogMessage } from "@/features/messages/model";
import { decrypt } from "@/features/secure-store/cipher";
import { packDialog, parseDialog, serializeDialog } from "@/features/secure-store/format";
import {
  deleteDialogFile,
  hasDialog,
  readDialogBuffer,
  readDialogIndex,
  writeDialogBuffer,
  writeDialogIndex,
} from "@/infra/tauriBridge";

import { useKeyringStore } from "@/features/keyring/keyringStore";

/** Декодирует base64-строку в `Uint8Array`. */
function decodeB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Достаёт ChaCha20-ключ диалога из `keyringStore`. Бросает, если
 * keystore не unlocked или keystore создан до появления `dialogKey`.
 */
function getKey(userId: string): Uint8Array {
  const dialogKeyB64 = useKeyringStore.getState().dialogKeyB64;
  if (dialogKeyB64 === null || dialogKeyB64.length === 0) {
    throw new Error(
      `dialog-store: нет dialogKey в памяти — keystore для ${userId} не unlocked, либо создан до появления dialog-key`,
    );
  }
  return decodeB64(dialogKeyB64);
}

/** Сортирует сообщения по `creation_datetime` по возрастанию. */
function sortByCreatedAt(messages: DialogMessage[]): DialogMessage[] {
  return [...messages].sort((a, b) =>
    a.creation_datetime < b.creation_datetime
      ? -1
      : a.creation_datetime > b.creation_datetime
        ? 1
        : 0,
  );
}

/** Убирает дубликаты по `id`, последнее вхождение побеждает. */
function dedupeById(messages: DialogMessage[]): DialogMessage[] {
  const seen = new Map<string, DialogMessage>();
  for (const m of messages) {
    seen.set(m.id, m);
  }
  return [...seen.values()];
}

/**
 * Читает полную историю одного чата. Возвращает `[]`, если файла
 * ещё нет (первый запуск, ничего не append'или).
 */
export async function readDialog(userId: string, chatId: string): Promise<DialogMessage[]> {
  if (!(await hasDialog(userId, chatId))) {
    return [];
  }
  const buf = await readDialogBuffer(userId, chatId);
  const { chachaNonce, ciphertext } = parseDialog(buf);
  const key = getKey(userId);
  const plaintext = decrypt(ciphertext, key, chachaNonce);
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  if (!Array.isArray(parsed)) {
    throw new Error("dialog-store: повреждённый файл — payload не массив");
  }
  return parsed as DialogMessage[];
}

/**
 * Дописывает одно или несколько сообщений в локальный файл чата.
 * Существующие сообщения сохраняются; при коллизии по `id` побеждает
 * новый ряд (сервер — авторитетный источник). Запись атомарна: либо
 * старый файл, либо новый, без полу-записанных состояний — поэтому
 * крэш в момент записи теряет максимум последнюю пачку.
 */
export async function appendDialog(
  userId: string,
  chatId: string,
  incoming: DialogMessage | DialogMessage[],
): Promise<void> {
  const additions = Array.isArray(incoming) ? incoming : [incoming];
  if (additions.length === 0) return;

  const existing = await readDialog(userId, chatId);
  const merged = sortByCreatedAt(dedupeById([...existing, ...additions]));

  const key = getKey(userId);
  const packed = serializeDialog(merged, key);
  await writeDialogBuffer(userId, chatId, packDialog(packed));

  // Best-effort: держим per-user индекс в синхроне. Ошибки здесь не
  // ломают чтение (есть fallback через `hasDialog`), поэтому глотаем.
  try {
    const index = await readDialogIndex(userId);
    if (!index.includes(chatId)) {
      await writeDialogIndex(userId, [...index, chatId]);
    }
  } catch {
    // ignore — следующее чтение сработает через проверку существования файла
  }
}

/** Синоним `appendDialog` для списка сообщений. */
export async function appendManyDialog(
  userId: string,
  chatId: string,
  incoming: DialogMessage[],
): Promise<void> {
  return appendDialog(userId, chatId, incoming);
}

/**
 * Стирает локальную копию одного чата. Шифрованный блоб удаляется
 * с диска; запись в per-user индексе тоже дропается, чтобы
 * `listDialogs` её не возвращал.
 */
export async function deleteDialog(userId: string, chatId: string): Promise<void> {
  await deleteDialogFile(userId, chatId);
  try {
    const index = await readDialogIndex(userId);
    const next = index.filter((id) => id !== chatId);
    if (next.length !== index.length) {
      await writeDialogIndex(userId, next);
    }
  } catch {
    // ignore
  }
}

/** Возвращает список `chatId`, для которых есть локальная копия на диске. */
export async function listDialogs(userId: string): Promise<string[]> {
  return readDialogIndex(userId);
}

/**
 * Сидит React Query `InfiniteData`-кеш из локального файла.
 * Возвращает кеш с одной страницей всех локально известных сообщений,
 * отсортированных по возрастанию `creation_datetime` (как сервер
 * выдаёт `usePrivateMessages` / `useGroupMessages`). Возвращает
 * `undefined`, если на диске ничего нет, — caller тогда просто
 * пропускает seed-шаг.
 *
 * Точка вызова: на mount чата, ДО сетевого fetch — серверный
 * `fetchPage0` потом дольёт сверху.
 */
export interface SeededPage<T> {
  pages: { items: T[] }[];
  pageParams: number[];
}

export async function seedCache(
  userId: string,
  chatId: string,
): Promise<SeededPage<DialogMessage> | undefined> {
  if (!(await hasDialog(userId, chatId))) {
    return undefined;
  }
  try {
    const local = await readDialog(userId, chatId);
    if (local.length === 0) return undefined;
    return {
      pages: [{ items: sortByCreatedAt(local) }],
      pageParams: [0],
    };
  } catch {
    // Повреждённый файл / неверный ключ — пусть серверный fetch перезапишет.
    return undefined;
  }
}
