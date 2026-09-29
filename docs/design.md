# Quant Messenger — Frontend Design Document

> **Версия:** 0.1 (draft)
> **Дата:** 2026-09-08
> **Автор:** frontend team
> **Статус:** утверждён, готов к реализации

---

## 0. TL;DR

Десктопный + Android-клиент для зашифрованного мессенджера Quant на **Tauri v2 + TypeScript + React**. Шифрование целиком на клиенте через `openpgp.js`, секреты в локальном keystore (`ChaCha20-Poly1305` + `Argon2id`). Real-time через polling существующего `/event/*` API бекенда (без изменений протокола). MVP разбит на 11 этапов.

---

## 1. Цели и ограничения

### 1.1. Продукт

E2E-encrypted мессенджер с архитектурой **zero-knowledge**: сервер не видит plaintext и не хранит приватные ключи. Это инвариант, который должен соблюдаться во всех слоях фронтенда.

### 1.2. Целевые платформы

- **Desktop:** Windows, macOS, Linux (используется системный WebView через Tauri)
- **Mobile:** Android (iOS — за рамками текущего этапа)

### 1.3. Что есть на бекенде (см. `/home/VcR3S9/Документы/code/python/Quant/docs/`)

- REST API на FastAPI, bearer-токены (TTL 1 час, без refresh)
- Сервер проверяет только подписи; шифрование — на клиенте
- Polling-уведомления через `/event/dialogs/`, `/event/groups/`
- Media: 2-фазная загрузка (`upload` → ссылка через `media_ids`)
- Поддержка приватных диалогов и групповых чатов
- БД: PostgreSQL / SQLite / MySQL / MariaDB

### 1.4. Что **не** трогаем на бекенде (см. `.agents/report_for_backend/`)

Все потенциальные улучшения API собраны в каталоге `.agents/report_for_backend/`. В текущем MVP они либо обходятся UI-хаком, либо отложены.

---

## 2. Технологический стек

| Слой | Технология | Версия | Обоснование |
|---|---|---|---|
| Runtime | **Tauri** | 2.x | Нативная производительность, малый размер бандла, официальная поддержка Android |
| Язык | **TypeScript** | 5.x, `strict: true` | Безопасность рефакторинга, типизированный API-клиент |
| UI-framework | **React** | 18.x | Экосистема, hiring-friendly |
| Сборка | **Vite** | 5.x | Быстрый dev-server, native-ESM |
| UI-кит | **Mantine** | 7.x | 100+ компонентов, формы, нотификации, hooks из коробки |
| Иконки | **@tabler/icons-react** | 3.x | Стандартные в паре с Mantine |
| Дата/время | **dayjs** | 1.x | Маленький, локализация из коробки |
| Server-state | **@tanstack/react-query** | 5.x | Кеш, retry, polling, мутации, optimistic updates |
| Client-state | **Zustand** | 4.x | Минимальный, без boilerplate, легко тестировать |
| Роутинг | **react-router-dom** | 6.x | Data-router API, loaders/actions |
| i18n | **react-i18next** | 14.x | RU + EN словари, переключение в runtime |
| PGP | **openpgp.js** | 6.x | Чистый JS+WASM, не требует GPG на машине, Curve25519/RSA, WebCrypto |
| KDF | **argon2-browser / hash-wasm** | latest | Argon2id для keystore |
| Cipher | **WebCrypto API** | built-in | ChaCha20-Poly1305 не в WebCrypto → используем **@stablelib/chacha20poly1305** (~10 KB) |
| Tauri-plugins | см. §7 | 2.x | FS, dialog, notification, deep-link, http |
| Линт/формат | **ESLint** + **Prettier** | flat-config | Единый стиль, pre-commit |
| Тесты | **Vitest** + **Playwright** | latest | Unit/integration/e2e |
| Прекоммит | **lefthook** или **husky** | latest | Запуск lint+typecheck перед коммитом |

### 2.1. Что **не** используем

- ❌ Redux / Redux Toolkit — Zustand покрывает все потребности
- ❌ Material UI / Chakra / Ant — Mantine выбран осознанно
- ❌ styled-components / Tailwind — Mantine использует Emotion
- ❌ Next.js / Remix — Tauri сам управляет shell'ом
- ❌ Axios — fetch + тонкая обёртка достаточны
- ❌ Socket.IO — используем polling
- ❌ Native GPG через Rust — хотим «один бандл»

---

## 3. Архитектура (high-level)

```
┌───────────────────────────────────────────────────────────┐
│                    Tauri Runtime (Rust)                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌───────────┐  │
│  │ fs / dialog /   │  │ Stronghold /    │  │ Mobile    │  │
│  │ notification /  │  │ secure-storage  │  │ lifecycle │  │
│  │ deep-link       │  │ (Android Keyst.)│  │ handlers  │  │
│  └────────┬────────┘  └────────┬────────┘  └─────┬─────┘  │
│           └───────────────────┬┴────────────────┘        │
│              Tauri IPC (invoke/event)                     │
└─────────────────────┬─────────────────────────────────────┘
                      │
┌─────────────────────┴─────────────────────────────────────┐
│             React App (WebView — system WebView)         │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │  UI (Mantine)│  │ Router       │  │ Notifications  │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────┘   │
│         └─────────────────┬┴───────────────────┘           │
│              ┌────────────┴────────────┐                  │
│              │   Zustand (UI state)   │                  │
│              │   TanStack Query       │                  │
│              │   (server state cache) │                  │
│              └────────────┬────────────┘                  │
│              ┌────────────┴────────────┐                  │
│              │   apiClient (typed)    │                  │
│              │   cryptoService (PGP)  │                  │
│              │   secureStorage (kdf+  │                  │
│              │   ChaCha20-Poly1305)   │                  │
│              └────────────┬────────────┘                  │
│              ┌────────────┴────────────┐                  │
│              │   tauriBridge (FS, OS)  │                  │
│              └─────────────────────────┘                  │
└─────────────────────┬─────────────────────────────────────┘
                      │ HTTPS (только транспорт)
┌─────────────────────┴─────────────────────────────────────┐
│               FastAPI Server (без изменений)              │
│   /auth · /users · /messages · /group-messages · /event   │
└───────────────────────────────────────────────────────────┘
```

**Принципы:**
- Feature-first структура (не layer-first)
- Каждый feature изолирован: `api.ts`, `queries.ts`/`mutations.ts`, `components/`
- PGP, secure-store, apiClient — singleton-сервисы с явной инициализацией
- Никакой бизнес-логики в React-компонентах

---

## 4. Структура проекта

```
Quant_tauri/
├── src/                          # React-приложение
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes/                   # React Router конфиг + страницы
│   │   ├── index.tsx
│   │   ├── LoginRoute.tsx
│   │   ├── RegisterRoute.tsx
│   │   ├── SetupKeyRoute.tsx
│   │   ├── ChatsRoute.tsx
│   │   ├── ChatRoute.tsx
│   │   ├── NewChatRoute.tsx
│   │   ├── NewGroupRoute.tsx
│   │   └── SettingsRoute.tsx
│   ├── features/                 # Bounded contexts (feature-first)
│   │   ├── auth/
│   │   │   ├── api.ts
│   │   │   ├── model.ts
│   │   │   ├── sessionStore.ts
│   │   │   └── components/
│   │   ├── keyring/
│   │   │   ├── generate.ts
│   │   │   ├── encrypt.ts
│   │   │   ├── armor.ts
│   │   │   └── components/
│   │   ├── secure-store/
│   │   │   ├── kdf.ts
│   │   │   ├── cipher.ts
│   │   │   ├── format.ts
│   │   │   └── store.ts
│   │   ├── chats/
│   │   │   ├── api.ts
│   │   │   ├── queries.ts
│   │   │   └── components/
│   │   ├── messages/
│   │   │   ├── api.ts
│   │   │   ├── queries.ts
│   │   │   ├── mutations.ts
│   │   │   └── components/
│   │   ├── media/
│   │   │   ├── api.ts
│   │   │   ├── pipeline.ts
│   │   │   └── components/
│   │   └── events/
│   │       ├── api.ts
│   │       └── polling.ts
│   ├── infra/
│   │   ├── apiClient.ts          # fetch + auth interceptor
│   │   ├── tauriBridge.ts        # invoke('plugin:*') обёртки
│   │   ├── env.ts                # парсинг VITE_API_URL
│   │   └── error.ts              # нормализация ошибок API
│   ├── ui/                       # design-system на Mantine
│   │   ├── theme.ts
│   │   ├── icons.tsx
│   │   └── components/
│   └── lib/                      # утилиты (uuid, base64, time)
├── src-tauri/                    # Rust
│   ├── src/
│   │   ├── lib.rs                # setup: плагины, deep-link, tray
│   │   ├── commands/             # минимальный набор
│   │   └── mobile.rs             # Android entry
│   ├── capabilities/default.json
│   ├── tauri.conf.json
│   ├── Cargo.toml
│   └── gen/android/
├── tests/
│   ├── unit/                     # vitest
│   ├── integration/              # docker-compose backend
│   └── e2e/                      # playwright на desktop-build
├── .agents/
│   └── report_for_backend/       # замечания для бекенд-команды
├── package.json
├── tsconfig.json                 # strict: true, noUncheckedIndexedAccess
├── vite.config.ts
├── eslint.config.js
├── prettier.config.js
├── lefthook.yml
└── README.md
```

---

## 5. Слой данных и криптография

### 5.1. PGP (`features/keyring`)

Используем **openpgp.js v6** — чистый JS+WASM, не требует системного GPG, поддерживает Curve25519/RSA, WebCrypto, streaming.

#### 5.1.1. Параметры ключей

- **По умолчанию:** ECC `curve25519Legacy` (быстрее RSA, меньше размер блобов, рекомендация RFC 9580).
- **Опционально:** RSA-4096 для совместимости со старыми клиентами (см. `docs/security.md`).

#### 5.1.2. API модуля

```ts
// features/keyring/encrypt.ts
export async function init(): Promise<void>;

export interface KeyPair {
  privateKeyArmored: string;   // ASCII-armored, зашифрован паролем
  publicKeyArmored: string;
  fingerprint: string;         // 40-hex, uppercase
}

export async function generate(
  userInfo: { name: string; email: string },
  passphrase: string,
  type?: 'ecc' | 'rsa'
): Promise<KeyPair>;

export async function importPublicKey(armored: string): Promise<PublicKey>;
export async function importPrivateKey(armored: string, passphrase: string): Promise<PrivateKey>;

// для текстового сообщения
export async function encryptText(
  text: string,
  recipientsPublicKeys: PublicKey[],
  signingKey: PrivateKey
): Promise<{ encrypted: Uint8Array; signature: Uint8Array }>;

export async function decryptText(
  encrypted: Uint8Array,
  signature: Uint8Array,
  sendersPublicKey: PublicKey,
  decryptionKey: PrivateKey
): Promise<{ text: string; verified: boolean }>;

// для медиа (detached signature)
export async function encryptFile(
  fileBytes: Uint8Array,
  recipientsPublicKeys: PublicKey[],
  signingKey: PrivateKey
): Promise<{ encrypted: Uint8Array; signature: Uint8Array; mime: string }>;

export async function decryptFile(
  encrypted: Uint8Array,
  signature: Uint8Array,
  sendersPublicKey: PublicKey,
  decryptionKey: PrivateKey
): Promise<Uint8Array>;

export async function fingerprintOf(publicKeyArmored: string): Promise<string>;
```

#### 5.1.3. Инварианты

- Шифрование и подпись делаются **до** сериализации в JSON.
- На сервер уходят только `bytes` → `base64` (см. `schemas.CreateMessage`).
- После `lock()` все `PrivateKey` ссылки очищаются через `openpgp.clearPrivateParams()`.

### 5.2. Secure storage (`features/secure-store`)

> Хранилище bearer-токена и приватного PGP-ключа — в **одном** шифрованном файле `keystore.qks` в каталоге приложения (Tauri `path::app_data_dir()`).

#### 5.2.1. Шифр

**ChaCha20-Poly1305** (AEAD) — современная альтернатива AES-GCM, одинаково быстрая на устройствах без AES-NI (все Android-смартфоны попадают в эту категорию). 256-бит ключ, 96-бит nonce, 128-бит тег аутентификации.

#### 5.2.2. KDF

**Argon2id** (memory-hard, OWASP рекомендация). Параметры:
- `m = 64 MiB`, `t = 3`, `p = 1`
- 32-байтный выход → ключ ChaCha20

Реализация: `hash-wasm` (чистый WASM, ~30 KB, без зависимости от нативного кода).

#### 5.2.3. Формат файла `keystore.qks`

```
┌────────┬────────┬──────┬──────────┬────────────┬───────────────────┐
│ magic  │ version│ flags│ kdf_salt │ chacha_nonce│ ciphertext+tag   │
│ 4 bytes│ 1 byte │1 byte│ 16 bytes │ 12 bytes   │ N bytes          │
└────────┴────────┴──────┴──────────┴────────────┴───────────────────┘
 "QKS1"   0x01     0x00     random      random     ChaCha20-Poly1305
```

#### 5.2.4. Plaintext внутри (JSON)

```json
{
  "version": 1,
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  },
  "accessToken": "...",
  "privateKeyArmored": "...",
  "publicKeyArmored": "...",
  "fingerprint": "ABCD ..."
}
```

#### 5.2.5. Поток unlock

```
1. Читаем keystore.qks → валидируем magic
2. KDF(Argon2id, passphrase, salt) → key
3. ChaCha20-Poly1305.decrypt(key, nonce, ciphertext)
4. Если тег неверный → ошибка «неверный пароль» (не различать с битым файлом)
5. Парсим JSON → sessionStore.set(...)
```

#### 5.2.6. Поток lock

```
1. openpgp.clearPrivateParams() для всех in-memory ключей
2. sessionStore.reset()
3. UI → редирект на /login
```

#### 5.2.7. Локальный диалог-стор (`features/dialog-store`)

> Шифрованный кеш истории сообщений на диске — чтобы чаты открывались мгновенно при старте и переживали рестарт без полной перекачки с сервера.

**Раскладка под `<app_data_dir>`**:
```
dialogs/
  <userId>/
    <chatId>.qdlog          — ChaCha20-Poly1305 блоб (QDLG1)
    index.json              — список chatId с локальной копией
```

**Ключ шифрования** — случайный 32-байтный блоб, генерируется один раз при создании keystore и кладётся в `KeystorePayload.dialogKey` (base64). В памяти живёт только в `keyringStore.dialogKeyB64` между unlock и lock. Без него `.qdlog` файлы не расшифровываются.

**Формат файла `<chatId>.qdlog`** (`QDLG1`, см. `secure-store/format.ts`):
```
┌────────┬────────┬────────────┬───────────────────┐
│ magic  │ version│ chacha_nonce│ ciphertext+tag   │
│ 4 bytes│ 1 byte │ 12 bytes   │ N bytes          │
└────────┴────────┴────────────┴───────────────────┘
 "QDLG"   0x01      random      ChaCha20-Poly1305
```

Plaintext внутри — JSON-сериализованный `DialogMessage[]`. Append-only: перед записью делается dedupe по `id` и сортировка по `creation_datetime`.

**Точки записи**:
- `useSendPrivateMessage` / `useSendGroupMessage` → `onSuccess` (после `replacePending`) → `appendDialog`
- `usePrivateMessages` / `useGroupMessages` → `useEffect` на смену данных → `appendManyDialog` (через ref для идемпотентности)

**Точка чтения**: на mount `ChatRoute` — `seedCache` ставит локальную историю в React Query-кеш ДО серверного fetch, чтобы первая отрисовка не требовала сети. Серверный ответ потом мержится поверх.

**Lock**: `keyringStore.lock()` стирает `dialogKeyB64` из памяти. Файлы остаются на диске, но без ключа нечитаемы до следующего unlock.

#### 5.2.8. Отправка с self-копией

> Каждое сообщение шифруется дважды: основная копия — ключом peer'а, self-копия — своим ключом. Бэкенд хранит обе (`encrypted_message` + `encrypted_message_self`) и отдаёт каждому viewer'у ту, что он может расшифровать. Отправитель видит свои сообщения, все его девайсы с общим keypair — тоже.

- Peer-ключ приходит с `GET /users/{id}/public-key` как base64 от armored-текста — `getUserPublicKey` декодирует в armor перед `importPublicKey`.
- `resolveRecipients` возвращает ключ peer'а; self-шифрование — второй вызов `encryptText` с собственным ключом. Обе detached-подписи сверяются сервером.
- POST-ответ содержит self-копию — UI отправителя расшифровывает сразу, без refetch.

### 5.3. API client (`infra/apiClient.ts`)

- Базовый URL из `VITE_API_URL` (build-time) + runtime-override через settings.
- Все PGP-блобы (`bytes`) → base64 в JSON через кастомный ревитер.
- Interceptor на 401: `sessionStore.onUnauthorized()` → событие для UI.
- `AbortController` на каждый запрос (отмена при размонтировании).
- Multipart только для `POST /auth/change-public-key`.

```ts
// infra/apiClient.ts — скелет
export class ApiError extends Error {
  constructor(public status: number, public detail: string) { super(detail); }
}

export const apiClient = {
  async get<T>(path: string, init?: RequestInit): Promise<T> { /* ... */ },
  async post<T>(path: string, body: unknown): Promise<T> { /* ... */ },
  async postMultipart<T>(path: string, form: FormData): Promise<T> { /* ... */ },
  async delete<T>(path: string): Promise<T> { /* ... */ },
};
```

---

## 6. State management

### 6.1. Server state — TanStack Query (v5)

| Query key | Stale time | Refetch |
|---|---|---|
| `['me']` | `Infinity` | по фокусу приложения |
| `['chats']` | 30 s | ручной refresh + при новых events |
| `['messages', chatId, cursor]` | 0 s | polling при открытом чате |
| `['events']` | 0 s | 5 s polling |

**Особенности:**
- Optimistic updates для `sendMessage` (статус `pending → sent → failed`).
- Retry-кнопка на failed-сообщениях.
- Infinite scroll для истории сообщений (cursor-based).
- `stale-while-revalidate` UX: кеш показывается мгновенно.

### 6.2. Client state — Zustand

```
sessionStore    { user, isUnlocked, fingerprint, lock() }
keyringStore    { status: 'empty'|'generating'|'ready', publicKey, fingerprint }
composerStore   { drafts: Record<chatId, string>, setDraft, clearDraft }
settingsStore   { theme, pollingIntervalMs, idleTimeoutMs, language }
```

**Никакого Redux.** Zustand весит <1 KB и идеально сочетается с TanStack Query.

---

## 7. Real-time стратегия (polling)

```
                       ┌───────────────────────┐
                       │  useEventsPolling()   │
                       │  interval = 5s (vis)  │
                       │  paused when hidden   │
                       └──────────┬────────────┘
                                  │ каждые 5s
                                  ▼
                       GET /event/dialogs/
                       GET /event/groups/
                                  │
                       если count > prev → invalidates
                       ['messages', chatId] → UI догружает
                       новые сообщения и расшифровывает
```

**Детали:**

- Polling стартует после `sessionStore.isUnlocked === true`.
- Пауза через `document.visibilitychange` на desktop и через Tauri `app://pause` / `app://resume` события на Android (см. §9.3).
- При фокусе на конкретный чат → `POST /event/dialog|group/readed/{event_id}`.
- Запросы stale-while-revalidate: показываем кеш, в фоне тянем новые.
- Backoff при сетевых ошибках: 5s → 10s → 30s → 60s → keep-alive.

---

## 8. Tauri-специфика (Rust)

### 8.1. Конфигурация плагинов

```toml
# src-tauri/Cargo.toml
[dependencies]
tauri = { version = "2", features = ["android"] }
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
tauri-plugin-notification = "2"
tauri-plugin-deep-link = "2"
tauri-plugin-stronghold = "2"          # fallback secure-storage
tauri-plugin-http = { version = "2", features = ["unsafe-headers"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
log = "0.4"
env_logger = "0.11"
```

**Кастомных Rust-команд минимум** (`src-tauri/src/commands/`):
- `get_app_data_dir() -> PathBuf` — обёртка над `path::app_data_dir()` (Android: `getFilesDir()`).
- `lock_screen_now()` — отправляет событие в WebView для стирания ключей.
- `log_frontend_error(level, message)` — единый мост в логи.

Остальное — стандартные плагины, без бизнес-логики в Rust.

### 8.2. Capabilities (`src-tauri/capabilities/default.json`)

Разрешаем только:
- `core:default`
- `dialog:allow-open`, `dialog:allow-save`
- `fs:allow-read-file`, `fs:allow-write-file` (только в `$APPDATA/**`)
- `notification:default`
- `deep-link:default`
- `stronghold:default`

**Никакого** `core:shell:allow-execute` — никаких произвольных команд ОС.

### 8.3. Mobile lifecycle (Android)

- Splash-screen → main activity → WebView.
- При `onPause`: событие `app://pause` в WebView → polling-pause, блокировка экрана.
- При `onResume`: `app://resume` → polling-resume, refresh, опциональный biometric unlock.
- Background notifications через `tauri-plugin-notification` (channel `messages`).
- Deep-link `quant://chat/{chat_id}` — открывает конкретный чат.

### 8.4. CSP

```json
"security": {
  "csp": "default-src 'self'; \
          img-src 'self' data: blob:; \
          connect-src 'self' ${VITE_API_URL}; \
          style-src 'self' 'unsafe-inline'; \
          script-src 'self' 'wasm-unsafe-eval'"
}
```

`wasm-unsafe-eval` нужен для openpgp.js (WASM-модули).

---

## 9. UI / UX

### 9.1. Тема и доступность

- Mantine `MantineProvider` + кастомная тема (тёмная/светлая, переключаемая).
- Полная i18n-готовность (`en`/`ru`) через `react-i18next`.
- Базовый размер шрифта 16 px, минимальная зона тапа 44×44 px (mobile).
- Контраст ≥ WCAG AA.

### 9.2. Экраны (роуты)

| Path | Экран | Доступ |
|---|---|---|
| `/login` | Email + пароль, кнопка unlock если есть keystore | Гость |
| `/register` | Регистрация + согласие на хранение ключа | Гость |
| `/setup-key` | Генерация / импорт PGP, экспорт keystore | После register |
| `/chats` | Список диалогов и групп, поиск | Авторизован |
| `/chats/new` | Создать диалог (ввод UUID собеседника) | Авторизован |
| `/chats/new-group` | Создать группу (имя + список UUID) | Авторизован |
| `/chats/:chatId` | Сообщения, медиа, ввод | Авторизован |
| `/settings` | Профиль, ключи, тема, idle-timeout, логаут | Авторизован |

**Auth guard** на уровне `<RequireAuth>` wrapper: если `!sessionStore.isUnlocked` → редирект на `/login`.

### 9.3. Глобальные компоненты

- `AppShell` (Mantine) с боковой навигацией (chats/settings) и top-bar (поиск, профиль).
- `<MessageBubble>` — варианты `mine | theirs | system`, verified-бэйдж после verify-подписи, статус доставки.
- `<MediaPreview>` — ленивая расшифровка по клику (не подгружаем blob, пока не запросили).
- `<UnreadBadge>` — счётчик из `useEventsPolling`.
- `<EmptyState>` — для пустого списка чатов.
- `<LockScreen>` — модал при idle timeout.

### 9.4. UX-детали

- **Шифрование индикатор:** зелёный замок если подпись верифицирована, красный если нет.
- **Отправка:** optimistic insert в кеш `['messages', chatId]`, статус `pending → sent → failed`. Retry-кнопка.
- **Загрузка медиа:** параллельно (`Promise.all`) для нескольких файлов; прогресс через `XMLHttpRequest.upload.onprogress` (Tauri http plugin).
- **Блокировка экрана:** по таймауту неактивности (default 5 мин desktop / 1 мин mobile), настраивается.
- **Drag-and-drop файлов** в desktop-сборке.
- **Pull-to-refresh** списка чатов на mobile.

---

## 10. Безопасность (чеклист)

| Угроза | Защита |
|---|---|
| XSS в имени чата/сообщениях | Mantine экранирует; CSP без `unsafe-inline` для скриптов; React по умолчанию |
| Утечка plaintext в логах | `log_frontend_error` через Tauri; фильтрация в Rust по `sensitive` тегу |
| Подмена публичного ключа | TOFU + показ fingerprint в профиле собеседника + опциональная out-of-band верификация (QR-код, отдельная фича v2) |
| Потеря keystore | Экспорт зашифрованного keystore при регистрации; восстановление через пароль |
| Memory dump | Расшифрованные ключи — только в `Uint8Array`; зануление через `openpgp.clearPrivateParams()` при lock |
| Network MITM | HTTPS only; HSTS в production |
| Android backup | `android:allowBackup="false"` в `AndroidManifest.xml` |
| Token theft | Bearer в keystore (`ChaCha20-Poly1305`), не в `localStorage` |
| Replay-атака на polling | Бекенд выдаёт counter, фронт просто сравнивает; защита — подпись сообщения |
| Фишинг при импорте ключа | Показ fingerprint + длина/тип ключа перед сохранением |

---

## 11. Сборка, релизы, тестирование

### 11.1. Скрипты `package.json`

```json
{
  "scripts": {
    "dev": "vite",
    "dev:tauri": "tauri dev",
    "build": "tsc --noEmit && vite build",
    "build:tauri": "tauri build",
    "build:android": "tauri android build --apk",
    "lint": "eslint . --max-warnings=0",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:e2e": "playwright test",
    "test:integration": "vitest run --config vitest.integration.config.ts"
  }
}
```

### 11.2. CI/CD

- GitHub Actions matrix: `ubuntu / macos / windows` × `test / build`.
- Release: tag → `tauri build` для desktop + `tauri android build --aab` для Play Store.
- Авто-подпись через `TAURI_SIGNING_PRIVATE_KEY` secret.

### 11.3. Тесты

| Уровень | Что покрываем |
|---|---|
| Unit | cryptoService (encrypt/decrypt round-trip), keystore (kdf+cipher), apiClient (моки MSW), reducers Zustand |
| Integration | docker-compose с бекендом: register → setup key → create chat → send encrypted message → logout → re-login → decrypt |
| E2E | Playwright на desktop-build: критические user-flows |
| Mobile | На каждый PR — smoke `tauri android build` (только компиляция) |
| Security | Статический анализ через `eslint-plugin-security` + ручной pentest перед релизом |

---

## 12. Поэтапный план реализации

> Каждый этап = отдельный PR. После каждого этапа — рабочий билд.

### Этап 1. Bootstrap (≈ 2 дня)
- Tauri v2 + Vite + React + TS strict
- Mantine + тема (dark/light)
- ESLint/Prettier/lefthook
- Health-check роут `/`

### Этап 2. Secure-store + keyring (≈ 3 дня)
- Argon2id + ChaCha20-Poly1305
- Формат `keystore.qks`
- Генерация / импорт PGP (UI ещё простой)
- Unit-тесты cryptoService

### Этап 3. Auth flow (≈ 2 дня)
- Login / Register / Logout
- Сохранение токена в keystore
- `/users/me` (current user)
- Экран повторного unlock при 401

### Этап 4. Chats list (≈ 2 дня)
- `/private-chats/`, `/group-chats/` (через дополнительные эндпоинты — TODO бекенд)
- Создание диалога (ввод UUID собеседника)
- Создание группы (имя + список UUID)

### Этап 5. Messages (text) (≈ 3 дня)
- Список сообщений + пагинация
- Send encrypted → optimistic → reconcile
- Decrypt в `<MessageBubble>` с verified-бэйджем
- Retry failed-сообщений

### Этап 6. Events polling (≈ 2 дня)
- `useEventsPolling` hook
- UnreadBadge в списке чатов
- mark-as-read при открытии
- Pause на hidden/background

### Этап 7. Media (≈ 3 дня)
- Выбор файла → encrypt+sign → upload → link → отправка
- Скачивание по клику с ленивой расшифровкой
- Параллельная загрузка с прогрессом

### Этап 8. Settings + Lock screen (≈ 2 дня)
- Профиль, смена публичного ключа
- Idle timeout → lock
- Theme/language pickers
- Экспорт keystore

### Этап 9. Mobile polish (≈ 3 дня)
- `tauri android build`
- Notification channel
- Deep-link `quant://chat/{id}`
- Mobile lifecycle (pause/resume)
- Pull-to-refresh, drag-drop fallback

### Этап 10. Hardening (≈ 2 дня)
- CSP-проверка (отчёт из Tauri)
- Security audit чеклиста §10
- Performance: виртуализация списка сообщений (`@tanstack/react-virtual`)
- Bundle size анализ (`vite-bundle-visualizer`)

### Этап 11. Docs & Release (≈ 1 день)
- README (build, dev, security model)
- CHANGELOG
- Релиз v0.1.0 (alpha) на GitHub Releases + Android internal track

**Итого:** ≈ 25 дней работы одного разработчика.

---

## 13. Открытые вопросы (бекенд)

Все вопросы к бекенд-команде собраны в `.agents/report_for_backend/`:

1. **Поиск пользователей** — нужен `GET /users/by-id/{id}` или `GET /users?ids=...` для batch-lookup профилей собеседников.
2. **Групповой PGP** — модель `GroupChat.public_key` сейчас заполняется публичным ключом создателя, что логически некорректно (см. `messages/router.py:292`).
3. **Refresh-токены** — сейчас bearer живёт 1 час, без refresh. Для UX важно.
4. **Голосовые/видео** — отложено, но есть идеи.
5. **Прочие наблюдения** — мелочи, найденные при анализе.

---

## 14. История изменений

| Версия | Дата | Изменения |
|---|---|---|
| 0.1 | 2026-09-08 | Первый драфт, MVP-план |
