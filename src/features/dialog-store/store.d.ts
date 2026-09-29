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
/**
 * Читает полную историю одного чата. Возвращает `[]`, если файла
 * ещё нет (первый запуск, ничего не append'или).
 */
export declare function readDialog(userId: string, chatId: string): Promise<DialogMessage[]>;
/**
 * Дописывает одно или несколько сообщений в локальный файл чата.
 * Существующие сообщения сохраняются; при коллизии по `id` побеждает
 * новый ряд (сервер — авторитетный источник). Запись атомарна: либо
 * старый файл, либо новый, без полу-записанных состояний — поэтому
 * крэш в момент записи теряет максимум последнюю пачку.
 */
export declare function appendDialog(userId: string, chatId: string, incoming: DialogMessage | DialogMessage[]): Promise<void>;
/** Синоним `appendDialog` для списка сообщений. */
export declare function appendManyDialog(userId: string, chatId: string, incoming: DialogMessage[]): Promise<void>;
/**
 * Стирает локальную копию одного чата. Шифрованный блоб удаляется
 * с диска; запись в per-user индексе тоже дропается, чтобы
 * `listDialogs` её не возвращал.
 */
export declare function deleteDialog(userId: string, chatId: string): Promise<void>;
/** Возвращает список `chatId`, для которых есть локальная копия на диске. */
export declare function listDialogs(userId: string): Promise<string[]>;
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
    pages: Array<{
        items: T[];
    }>;
    pageParams: number[];
}
export declare function seedCache(userId: string, chatId: string): Promise<SeededPage<DialogMessage> | undefined>;
