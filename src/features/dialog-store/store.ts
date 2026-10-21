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
 * Стирает ВСЕ локальные копии диалогов пользователя (настройки
 * «стереть данные устройства»). Файлы .qdlog удаляются, per-user
 * индекс обнуляется. Best-effort: возвращает число удалённых
 * диалогов; если индекс нечитаем — 0 без попыток удаления и записи
 * индекса; прочие ошибки глотаются. Никогда не бросает.
 */
export async function clearDialogs(userId: string): Promise<number> {
  let index: string[];
  try {
    index = await readDialogIndex(userId);
  } catch {
    return 0;
  }
  // Индекс — строка JSON от собственного writer'а, но на битом файле
  // там может оказаться что угодно: фильтруем до непустых строк.
  const chatIds = index.filter((id): id is string => typeof id === "string" && id.length > 0);
  await Promise.all(
    chatIds.map((chatId) =>
      deleteDialogFile(userId, chatId).catch(() => {
        // Best-effort: конкретный файл мог уже не существовать —
        // не роняем всю пачку из-за одного сбоя.
      }),
    ),
  );
  try {
    await writeDialogIndex(userId, []);
  } catch {
    // ignore — пустой индекс восстановится сам, когда появятся новые чаты
  }
  return chatIds.length;
}

/**
 * Автоочистка локальной истории («retention sweep»): удаляет из
 * `.qdlog`-файлов сообщения старше `retentionDays` дней.
 *
 * Контракт:
 * - `retentionDays <= 0` (или non-finite) — no-op, `0`, индекс не читаем;
 * - cutoff = `Date.now() - retentionDays * 86_400_000`;
 * - сообщения с `Date.parse(creation_datetime) >= cutoff` остаются,
 *   непарсящиеся даты ОСТАЮТСЯ (защита от потери данных);
 * - файл переписывается только если что-то удалено; если удалено всё —
 *   чат стирается через `deleteDialog` (файл + запись в индексе);
 * - возвращает суммарное число удалённых сообщений.
 *
 * Best-effort: ошибка чтения одного чата (залоченный keystore, битый
 * файл) пропускает этот чат; функция никогда не reject'ит.
 */
export async function applyDialogRetention(userId: string, retentionDays: number): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoff = Date.now() - retentionDays * 86_400_000;
  let removed = 0;
  try {
    const index = await readDialogIndex(userId);
    // Индекс — строка JSON от собственного writer'а, но на битом файле
    // там может оказаться что угодно: фильтруем до непустых строк.
    const chatIds = index.filter((id): id is string => typeof id === "string" && id.length > 0);
    for (const chatId of chatIds) {
      let original: DialogMessage[];
      try {
        original = await readDialog(userId, chatId);
      } catch {
        // Залоченный keystore / битый файл — пропускаем чат.
        continue;
      }
      const kept = original.filter((m) => {
        const ts = Date.parse(m.creation_datetime);
        return Number.isNaN(ts) || ts >= cutoff;
      });
      if (kept.length === original.length) continue;
      if (kept.length === 0) {
        // Пустой чат — целиком, вместе с записью в индексе.
        await deleteDialog(userId, chatId);
        removed += original.length;
        continue;
      }
      const key = getKey(userId);
      const packed = serializeDialog(kept, key);
      await writeDialogBuffer(userId, chatId, packDialog(packed));
      // Best-effort: держим per-user индекс в синхроне (как `appendDialog`).
      try {
        const indexNow = await readDialogIndex(userId);
        if (!indexNow.includes(chatId)) {
          await writeDialogIndex(userId, [...indexNow, chatId]);
        }
      } catch {
        // ignore — следующее чтение сработает через проверку файла
      }
      removed += original.length - kept.length;
    }
    return removed;
  } catch {
    // Частичный результат лучше, чем reject в фоновом свипе.
    return removed;
  }
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
