# Subagent Tasks Breakdown

> Декомпозиция `docs/design.md` на конкретные задачи для субагентов.
> Каждая задача — атомарная, с чёткими inputs/outputs, рассчитана на 1 вызов subagent.
> **Целевой бюджет:** ≤ 50k токенов на задачу (max 200k).

---

## Правила вызова субагентов

### Token budget

- **soft limit:** 50k токенов (вход + выход)
- **hard limit:** 200k токенов — если задача приближается, разбивать ещё мельче
- Считать ориентировочно: 1 KB кода ≈ 250–400 токенов; 1 KB markdown ≈ 300–500 токенов

### Шаблон промпта субагента

```
Ты — [роль]. Работаешь в проекте Quant Messenger (E2E-encrypted мессенджер).

КОНТЕКСТ:
- Дизайн-документ: /home/VcR3S9/Документы/code/js/Quant_tauri/docs/design.md
- Backend (только для понимания API): /home/VcR3S9/Документы/code/python/Quant
- Рабочая директория: /home/VcR3S9/Документы/code/js/Quant_tauri

ЗАДАЧА: <TITLE> (TASK-XXX, phase <N>)

ПРОЧИТАЙ:
- <file 1>
- <file 2>
...

СОЗДАЙ / ИЗМЕНИ:
- <file 1> — <что именно>
- <file 2> — <что именно>

ТРЕБОВАНИЯ:
- TypeScript strict mode (см. design.md §2)
- [другие constraints]

НЕ ТРОГАЙ:
- [явные ограничения]

OUT OF SCOPE:
- [что не делать]

ACCEPTANCE:
- [ ] <критерий 1>
- [ ] <критерий 2>

В конце напиши краткий отчёт (3-5 строк): что сделано, какие решения приняты.
```

### Когда параллелить, когда последовательно

- Параллелить можно всё, что не имеет `depends_on` друг на друга
- Не параллелить: если две задачи пишут в один и тот же файл
- Инфраструктурные задачи (TASK-001..005) — строго последовательно
- Фичи можно параллелить после установки инфраструктуры

---

## Карта зависимостей (high-level)

```
Phase 1  Bootstrap
  TASK-001 → TASK-002 → TASK-003 → TASK-004 → TASK-005
                                                        ↓
Phase 2  Core infra (можно параллелить)
  TASK-010 (secure-store)
  TASK-012 (keyring)         ←─ depends on TASK-010
  TASK-013 (apiClient)
  TASK-014 (tauriBridge)
  TASK-015 (error)

Phase 3  State + Router
  TASK-020 (QueryProvider)
  TASK-021..024 (stores)     ←─ depends on TASK-013, TASK-012
  TASK-025 (Router+guard)    ←─ depends on TASK-021

Phase 4  Auth UI
  TASK-030 (Login)
  TASK-031 (Register)
  TASK-032 (SetupKey)
  TASK-033 (UnlockAgain)
  TASK-034 (RequireAuth)     ←─ depends on TASK-025, TASK-021

Phase 5  Chats
  TASK-040 (api)             ←─ depends on TASK-013
  TASK-041 (queries)         ←─ depends on TASK-040, TASK-020
  TASK-042 (ChatsRoute)      ←─ depends on TASK-041, TASK-034
  TASK-043 (ChatItem)        ←─ depends on TASK-042
  TASK-044 (NewChat)         ←─ depends on TASK-040, TASK-034
  TASK-045 (NewGroup)        ←─ depends on TASK-040, TASK-034

Phase 6  Messages
  TASK-050 (api)             ←─ depends on TASK-013
  TASK-051 (queries)         ←─ depends on TASK-050, TASK-020
  TASK-052 (mutations)       ←─ depends on TASK-050, TASK-012
  TASK-053 (MessageBubble)   ←─ depends on TASK-051, TASK-012
  TASK-054 (Composer)        ←─ depends on TASK-052, TASK-023
  TASK-055 (retry logic)     ←─ depends on TASK-052

Phase 7  Events
  TASK-060 (api)             ←─ depends on TASK-013
  TASK-061 (polling hook)    ←─ depends on TASK-060, TASK-020, TASK-021
  TASK-062 (UnreadBadge)     ←─ depends on TASK-061
  TASK-063 (mark-as-read)    ←─ depends on TASK-061

Phase 8  Media
  TASK-070 (api)             ←─ depends on TASK-013
  TASK-071 (encrypt+upload)  ←─ depends on TASK-070, TASK-012
  TASK-072 (decrypt+dl)      ←─ depends on TASK-070, TASK-012
  TASK-073 (MediaPreview)    ←─ depends on TASK-072
  TASK-074 (progress UI)     ←─ depends on TASK-071

Phase 9  Settings + Lock
  TASK-080 (settingsStore)   ←─ depends on TASK-024
  TASK-081 (SettingsRoute)   ←─ depends on TASK-080, TASK-034
  TASK-082 (change key UI)   ←─ depends on TASK-081, TASK-014
  TASK-083 (export keystore) ←─ depends on TASK-010, TASK-014
  TASK-084 (idle timeout)    ←─ depends on TASK-080, TASK-021

Phase 10 Mobile
  TASK-090 (tauri.conf)      ←─ depends on TASK-100
  TASK-091 (notifications)   ←─ depends on TASK-061, TASK-090
  TASK-092 (deep-link)       ←─ depends on TASK-025, TASK-090
  TASK-093 (lifecycle)       ←─ depends on TASK-061, TASK-090
  TASK-094 (manifest)        ←─ depends on TASK-090

Phase 10.5 Rust commands
  TASK-100 (Cargo.toml + capabilities)
  TASK-101 (lib.rs setup)
  TASK-102 (get_app_data_dir)
  TASK-103 (lock_screen_now)
  TASK-104 (log_frontend_error)

Phase 11 i18n
  TASK-110 (i18n setup)
  TASK-111 (language switcher)
  TASK-112 (theme switcher)

Phase 12 Testing
  TASK-120 (vitest)
  TASK-121 (cryptoService tests)
  TASK-122 (secureStore tests)
  TASK-123 (apiClient tests + MSW)
  TASK-124 (integration docker-compose)
  TASK-125 (playwright)

Phase 13 CI/CD
  TASK-130 (GH Actions matrix)
  TASK-131 (Release workflow)
```

---

## Phase 1 — Bootstrap

### TASK-001: Tauri v2 + Vite + React + TS scaffold

- **Phase:** 1
- **Tokens:** ~30k
- **Inputs:**
  - `docs/design.md` §1–4
- **Outputs:**
  - `package.json` (deps: react 18, vite 5, tauri-apps 2, typescript 5)
  - `vite.config.ts` (React plugin, alias `@/*` → `src/*`)
  - `index.html`
  - `src/main.tsx` (точка входа)
  - `src/App.tsx` (заглушка с `<div>Quant</div>`)
  - `tsconfig.json` (strict: true, noUncheckedIndexedAccess, paths)
  - `.gitignore`
- **Depends on:** —
- **Parallel with:** —
- **Subagent prompt role:** frontend-bridge-engineer
- **Acceptance:**
  - [ ] `npm run dev` стартует Vite без ошибок
  - [ ] `npm run typecheck` зелёный
  - [ ] `src/App.tsx` рендерит «Quant» в браузере

---

### TASK-002: Strict TS config + aliases

- **Phase:** 1
- **Tokens:** ~15k
- **Inputs:** `docs/design.md` §2 (TS strict requirements)
- **Outputs:**
  - `tsconfig.json` (полный с paths для `@/features/*`, `@/infra/*`, `@/ui/*`, `@/lib/*`)
  - `tsconfig.node.json` (для vite.config)
- **Depends on:** TASK-001
- **Parallel with:** TASK-003, TASK-004, TASK-005
- **Acceptance:**
  - [ ] `import x from '@/lib/uuid'` работает
  - [ ] `noUncheckedIndexedAccess` ловит `arr[0]` → `T | undefined`

---

### TASK-003: Mantine v7 provider + theme

- **Phase:** 1
- **Tokens:** ~25k
- **Inputs:** `docs/design.md` §9.1
- **Outputs:**
  - `src/ui/theme.ts` (light + dark, цвета бренда)
  - `src/main.tsx` (обновить: обернуть `<App />` в `<MantineProvider theme={...}>`)
  - `src/ui/components/ColorSchemeToggle.tsx`
- **Depends on:** TASK-001
- **Parallel with:** TASK-002, TASK-004, TASK-005
- **Acceptance:**
  - [ ] При загрузке видна тёмная тема
  - [ ] ColorSchemeToggle переключает тему
  - [ ] Emotion CSS-in-JS не конфликтует

---

### TASK-004: ESLint + Prettier + lefthook

- **Phase:** 1
- **Tokens:** ~20k
- **Inputs:** `docs/design.md` §2 (lint/format row in stack)
- **Outputs:**
  - `eslint.config.js` (flat config: typescript-eslint, react-hooks, react-refresh, import, security)
  - `.prettierrc.json`
  - `lefthook.yml` (pre-commit: lint, typecheck, format)
- **Depends on:** TASK-001
- **Parallel with:** TASK-002, TASK-003, TASK-005
- **Acceptance:**
  - [ ] `npm run lint` зелёный
  - [ ] `npm run format` форматирует без ошибок
  - [ ] pre-commit запускает lint+typecheck

---

### TASK-005: Vite config (path aliases, env, build opts)

- **Phase:** 1
- **Tokens:** ~15k
- **Outputs:**
  - `vite.config.ts` (resolve.alias, define для VITE_API_URL, build.target esnext, optimizeDeps для openpgp)
  - `src/infra/env.ts` (читает `import.meta.env.VITE_API_URL`, валидирует тип)
- **Depends on:** TASK-001
- **Parallel with:** TASK-002, TASK-003, TASK-004
- **Acceptance:**
  - [ ] `process.env.NODE_ENV` корректно подставляется в сборке
  - [ ] Vite optimizeDeps не падает на openpgp

---

## Phase 2 — Core infra

### TASK-010: secure-store (Argon2id + ChaCha20-Poly1305)

- **Phase:** 2
- **Tokens:** ~45k
- **Inputs:** `docs/design.md` §5.2
- **Outputs:**
  - `src/features/secure-store/kdf.ts` (Argon2id через hash-wasm)
  - `src/features/secure-store/cipher.ts` (ChaCha20-Poly1305 через @stablelib/chacha20poly1305)
  - `src/features/secure-store/format.ts` (парсинг/сериализация бинарного формата keystore.qks)
  - `src/features/secure-store/store.ts` (read/write через tauri fs plugin)
  - `src/features/secure-store/types.ts` (KeystorePayload, KeystoreFile interfaces)
- **Depends on:** TASK-001, TASK-005
- **Parallel with:** TASK-013, TASK-014
- **Acceptance:**
  - [ ] Encrypt → decrypt round-trip даёт идентичный plaintext
  - [ ] Неправильный пароль → ошибка (не паника)
  - [ ] Формат файла соответствует design §5.2.3

---

### TASK-011: secure-store unit tests

- **Phase:** 2
- **Tokens:** ~25k
- **Inputs:** TASK-010 outputs
- **Outputs:**
  - `tests/unit/secure-store/cipher.test.ts`
  - `tests/unit/secure-store/kdf.test.ts`
  - `tests/unit/secure-store/format.test.ts`
- **Depends on:** TASK-010
- **Acceptance:**
  - [ ] Round-trip test зелёный
  - [ ] Wrong password → throws
  - [ ] Corrupted file → throws (не паника)

---

### TASK-012: keyring service (openpgp.js wrapper)

- **Phase:** 2
- **Tokens:** ~50k
- **Inputs:** `docs/design.md` §5.1
- **Outputs:**
  - `src/features/keyring/encrypt.ts` (init, generate, importPublicKey, importPrivateKey, encryptText, decryptText, encryptFile, decryptFile, fingerprintOf)
  - `src/features/keyring/armor.ts` (утилиты для ASCII-armor)
  - `src/features/keyring/types.ts` (KeyPair, EncryptResult interfaces)
- **Depends on:** TASK-010
- **Parallel with:** TASK-013, TASK-014, TASK-015
- **Acceptance:**
  - [ ] generateKey → возвращает валидный ECC keypair
  - [ ] encryptText + decryptText round-trip
  - [ ] encryptFile + decryptFile round-trip с бинарными данными
  - [ ] fingerprint извлекается корректно

---

### TASK-013: apiClient (typed fetch wrapper)

- **Phase:** 2
- **Tokens:** ~35k
- **Inputs:** `docs/design.md` §5.3
- **Outputs:**
  - `src/infra/apiClient.ts` (ApiError class, apiClient с get/post/postMultipart/delete)
  - `src/infra/error.ts` (нормализация ошибок FastAPI: {detail: string|array})
  - `src/infra/types.ts` (общие типы: ApiError, RequestOptions)
- **Depends on:** TASK-001
- **Parallel with:** TASK-010, TASK-012, TASK-014, TASK-015
- **Acceptance:**
  - [ ] 401 → ApiError со статусом 401
  - [ ] AbortController отменяет запрос
  - [ ] base64 ↔ Uint8Array ревитер работает

---

### TASK-014: tauriBridge (FS/dialog wrappers)

- **Phase:** 2
- **Tokens:** ~30k
- **Inputs:** `docs/design.md` §8 (Rust commands + plugins)
- **Outputs:**
  - `src/infra/tauriBridge.ts` (readKeystore, writeKeystore, pickFile, saveFile, lockScreenNow, getAppDataDir, onPause/onResume events)
  - `src/infra/tauri.types.ts` (типизация для invoke responses)
- **Depends on:** TASK-100 (Cargo.toml), TASK-005
- **Parallel with:** TASK-010, TASK-012, TASK-013, TASK-015
- **Acceptance:**
  - [ ] Все обёртки имеют TS-типы
  - [ ] Нет прямых `invoke()` вызовов в фичах

---

### TASK-015: error normalization (расширенная)

- **Phase:** 2
- **Tokens:** ~15k
- **Outputs:**
  - `src/infra/error.ts` (ApiError → user-friendly messages, маппинг 401/403/404/413/422/500 на человеческие тексты)
  - `src/lib/result.ts` (Result<T, E> тип для graceful error handling)
- **Depends on:** TASK-001
- **Parallel with:** TASK-010..014
- **Acceptance:**
  - [ ] FastAPI `detail: "Need add public key"` → "Сначала добавьте публичный ключ"

---

## Phase 3 — State management + Router

### TASK-020: TanStack Query provider

- **Phase:** 3
- **Tokens:** ~20k
- **Outputs:**
  - `src/infra/queryClient.ts` (QueryClient с дефолтами: retry 1, staleTime по типу)
  - `src/main.tsx` (обновить: обернуть в `<QueryClientProvider>`)
- **Depends on:** TASK-013
- **Acceptance:**
  - [ ] QueryClientProvider в main.tsx
  - [ ] Дефолты: staleTime Infinity для ['me'], retry 1 для всех

---

### TASK-021: sessionStore (Zustand)

- **Phase:** 3
- **Tokens:** ~25k
- **Outputs:**
  - `src/features/auth/sessionStore.ts` (state: user, isUnlocked, fingerprint; actions: set, lock, onUnauthorized)
  - `src/features/auth/model.ts` (User interface, Token interface)
- **Depends on:** TASK-013
- **Parallel with:** TASK-022, TASK-023, TASK-024
- **Acceptance:**
  - [ ] `useSessionStore.getState().lock()` очищает все поля
  - [ ] persist middleware НЕ используется (zero-knowledge)

---

### TASK-022: keyringStore

- **Phase:** 3
- **Tokens:** ~15k
- **Outputs:**
  - `src/features/keyring/keyringStore.ts` (state: status, publicKeyArmored, privateKey, fingerprint; actions: setStatus, setKeys, clear)
- **Depends on:** TASK-012, TASK-021
- **Acceptance:**
  - [ ] При lock → privateKey = null, status = 'locked'

---

### TASK-023: composerStore

- **Phase:** 3
- **Tokens:** ~12k
- **Outputs:**
  - `src/features/messages/composerStore.ts` (drafts: Record<chatId, {text, mediaFiles}>, setDraft, clearDraft)
- **Depends on:** TASK-001
- **Acceptance:**
  - [ ] При переключении чатов черновики не теряются

---

### TASK-024: settingsStore

- **Phase:** 3
- **Tokens:** ~15k
- **Outputs:**
  - `src/features/settings/settingsStore.ts` (theme, pollingIntervalMs, idleTimeoutMs, language, apiBaseUrl)
- **Depends on:** TASK-001
- **Acceptance:**
  - [ ] SettingsStore persist через `@tauri-apps/plugin-store` (НЕ в keystore)

---

### TASK-025: Router + auth guard

- **Phase:** 3
- **Tokens:** ~30k
- **Outputs:**
  - `src/routes/index.tsx` (createBrowserRouter с роутами из design §9.2)
  - `src/routes/RequireAuth.tsx` (обёртка с редиректом на /login если !isUnlocked)
  - `src/routes/AppShellRoute.tsx` (обёртка с Mantine AppShell для авторизованной зоны)
- **Depends on:** TASK-021, TASK-020
- **Acceptance:**
  - [ ] Неавторизованный пользователь на `/chats` → редирект на `/login`
  - [ ] После unlock → редирект на запрошенный URL

---

## Phase 4 — Auth UI

### TASK-030: LoginRoute

- **Phase:** 4
- **Tokens:** ~30k
- **Outputs:**
  - `src/routes/LoginRoute.tsx` (форма email+password, submit → auth/api.login)
  - `src/features/auth/api.ts` (login, register, logout, me)
  - `src/features/auth/queries.ts` (useMe, useLogin, useRegister)
- **Depends on:** TASK-021, TASK-013
- **Parallel with:** TASK-031, TASK-032, TASK-033, TASK-034
- **Acceptance:**
  - [ ] Неверный пароль → отображение ошибки (не throw)
  - [ ] После login → редирект на /chats

---

### TASK-031: RegisterRoute

- **Phase:** 4
- **Tokens:** ~25k
- **Outputs:**
  - `src/routes/RegisterRoute.tsx` (форма email+password+confirm, success → /setup-key)
- **Depends on:** TASK-030 (использует useRegister)
- **Parallel with:** TASK-030, TASK-032, TASK-033, TASK-034
- **Acceptance:**
  - [ ] Валидация на клиенте (email format, password length)
  - [ ] После успеха → редирект на /setup-key

---

### TASK-032: SetupKeyRoute (PGP gen/import)

- **Phase:** 4
- **Tokens:** ~45k
- **Outputs:**
  - `src/routes/SetupKeyRoute.tsx` (3 вкладки: «Создать», «Импортировать», «Экспортировать keystore»)
  - `src/features/keyring/generate.ts` (UI-обёртка над TASK-012 с индикатором прогресса)
  - `src/features/auth/api.ts` (добавить changePublicKey через multipart)
- **Depends on:** TASK-012, TASK-010, TASK-014
- **Parallel with:** TASK-030, TASK-031, TASK-033, TASK-034
- **Acceptance:**
  - [ ] Генерация ECC ключа показывает прогресс
  - [ ] После генерации → кнопка «Сохранить публичный ключ» → POST /auth/change-public-key
  - [ ] Импорт armored → валидация → сохранение

---

### TASK-033: UnlockAgainScreen

- **Phase:** 4
- **Tokens:** ~25k
- **Outputs:**
  - `src/ui/components/UnlockAgainModal.tsx` (модал с полем пароля, триггер при 401)
  - `src/infra/apiClient.ts` (обновить: interceptor на 401 → открывает модал)
- **Depends on:** TASK-021, TASK-010
- **Parallel with:** TASK-030..032, TASK-034
- **Acceptance:**
  - [ ] При 401 в любом запросе → модал появляется
  - [ ] После unlock → оригинальный запрос повторяется

---

### TASK-034: RequireAuth wrapper (уже создан в TASK-025, но тут — расширение)

- **Phase:** 4
- **Tokens:** ~15k
- **Outputs:**
  - `src/routes/RequireAuth.tsx` (обновить: проверка sessionStore.isUnlocked + loading state)
- **Depends on:** TASK-025, TASK-021
- **Acceptance:**
  - [ ] Loading state не «мигает»

---

## Phase 5 — Chats

### TASK-040: chats/api.ts

- **Phase:** 5
- **Tokens:** ~20k
- **Outputs:**
  - `src/features/chats/api.ts` (getAllPrivateChats, getAllGroupChats, createPrivateChat, createGroupChat, getChat)
  - `src/features/chats/model.ts` (DialogChat, GroupChat interfaces)
- **Depends on:** TASK-013
- **Parallel with:** TASK-050, TASK-060, TASK-070
- **Acceptance:**
  - [ ] Типы соответствуют backend схемам
  - [ ] Ошибки ApiError нормализованы

---

### TASK-041: chats/queries.ts

- **Phase:** 5
- **Tokens:** ~25k
- **Outputs:**
  - `src/features/chats/queries.ts` (usePrivateChats, useGroupChats, useCreatePrivateChat, useCreateGroupChat с TanStack Query)
- **Depends on:** TASK-040, TASK-020
- **Acceptance:**
  - [ ] usePrivateChats имеет staleTime 30s
  - [ ] При ошибке 405 (no public key) → UI показывает баннер «настройте ключ»

---

### TASK-042: ChatsRoute page

- **Phase:** 5
- **Tokens:** ~35k
- **Outputs:**
  - `src/routes/ChatsRoute.tsx` (Mantine AppShell с боковой панелью и списком чатов)
  - `src/ui/components/ChatListEmpty.tsx`
- **Depends on:** TASK-041, TASK-034, TASK-062
- **Acceptance:**
  - [ ] Список диалогов и групп с сортировкой по last_message_at (если в API)
  - [ ] UnreadBadge на каждой строке

---

### TASK-043: ChatItem component

- **Phase:** 5
- **Tokens:** ~15k
- **Outputs:**
  - `src/features/chats/components/ChatItem.tsx` (аватар, имя, последнее сообщение preview, время, unread count)
- **Depends on:** TASK-042
- **Acceptance:**
  - [ ] Preview обрезается до 60 символов

---

### TASK-044: NewChatRoute (создать диалог)

- **Phase:** 5
- **Tokens:** ~25k
- **Outputs:**
  - `src/routes/NewChatRoute.tsx` (форма с полем UUID собеседника + имя чата)
- **Depends on:** TASK-040, TASK-034
- **Acceptance:**
  - [ ] После создания → редирект на /chats/:id

---

### TASK-045: NewGroupRoute (создать группу)

- **Phase:** 5
- **Tokens:** ~30k
- **Outputs:**
  - `src/routes/NewGroupRoute.tsx` (имя + multi-select пользователей по UUID; см. design §10 про обходной путь группового шифрования)
- **Depends on:** TASK-040, TASK-034
- **Acceptance:**
  - [ ] Минимум 1 участник (помимо создателя)
  - [ ] Предупреждение: «Групповое E2E в MVP обходится (см. report_for_backend/02)»

---

## Phase 6 — Messages

### TASK-050: messages/api.ts

- **Phase:** 6
- **Tokens:** ~20k
- **Outputs:**
  - `src/features/messages/api.ts` (getMessages с cursor, sendMessage, deleteMessage)
  - `src/features/messages/model.ts` (Message interface, CursorPage)
- **Depends on:** TASK-013
- **Parallel with:** TASK-040, TASK-060, TASK-070
- **Acceptance:**
  - [ ] Cursor-based pagination работает

---

### TASK-051: messages/queries.ts (с пагинацией)

- **Phase:** 6
- **Tokens:** ~30k
- **Outputs:**
  - `src/features/messages/queries.ts` (useMessages(chatId) с useInfiniteQuery, кеш по ['messages', chatId])
- **Depends on:** TASK-050, TASK-020
- **Acceptance:**
  - [ ] Infinite scroll при scroll вверх
  - [ ] Кеш не очищается при переключении чатов

---

### TASK-052: messages/mutations.ts (send + optimistic)

- **Phase:** 6
- **Tokens:** ~45k
- **Outputs:**
  - `src/features/messages/mutations.ts` (useSendMessage с optimistic insert → encrypt → POST → reconcile)
  - `src/features/messages/pipeline.ts` (encryptMessageForChat: getRecipientKeys, encryptText, return {encrypted, signature})
- **Depends on:** TASK-050, TASK-012
- **Acceptance:**
  - [ ] Optimistic insert виден сразу
  - [ ] При ошибке сервера → статус → 'failed', кнопка retry

---

### TASK-053: MessageBubble component

- **Phase:** 6
- **Tokens:** ~40k
- **Outputs:**
  - `src/features/messages/components/MessageBubble.tsx` (mine|theirs|system варианты, verified-бэйдж, статус доставки)
  - `src/features/messages/decrypt.ts` (decryptMessageInBackground с кешем расшифровки)
- **Depends on:** TASK-051, TASK-012
- **Acceptance:**
  - [ ] Verified-бэйдж зелёный если подпись ОК, красный если нет

---

### TASK-054: Composer component

- **Phase:** 6
- **Tokens:** ~30k
- **Outputs:**
  - `src/features/messages/components/Composer.tsx` (textarea + кнопка отправки + attachment button)
- **Depends on:** TASK-052, TASK-023
- **Acceptance:**
  - [ ] Enter → отправка, Shift+Enter → newline
  - [ ] Draft сохраняется в composerStore

---

### TASK-055: retry failed messages

- **Phase:** 6
- **Tokens:** ~15k
- **Outputs:**
  - `src/features/messages/retry.ts` (retryFailedMessage(messageId))
- **Depends on:** TASK-052
- **Acceptance:**
  - [ ] Кнопка retry видна только для failed

---

## Phase 7 — Events / polling

### TASK-060: events/api.ts

- **Phase:** 7
- **Tokens:** ~12k
- **Outputs:**
  - `src/features/events/api.ts` (getDialogEvents, getGroupEvents, markDialogRead, markGroupRead)
  - `src/features/events/model.ts` (Event interfaces)
- **Depends on:** TASK-013
- **Parallel with:** TASK-040, TASK-050, TASK-070
- **Acceptance:**
  - [ ] Типы соответствуют `docs/api.md`

---

### TASK-061: useEventsPolling hook

- **Phase:** 7
- **Tokens:** ~40k
- **Outputs:**
  - `src/features/events/polling.ts` (useEventsPolling с react-query useQuery + setInterval, visibility API, mobile lifecycle)
- **Depends on:** TASK-060, TASK-020, TASK-021, TASK-093
- **Acceptance:**
  - [ ] При скрытой вкладке polling paused
  - [ ] На mobile при onPause polling paused
  - [ ] Backoff при сетевых ошибках

---

### TASK-062: UnreadBadge component

- **Phase:** 7
- **Tokens:** ~12k
- **Outputs:**
  - `src/ui/components/UnreadBadge.tsx`
- **Depends on:** TASK-061
- **Acceptance:**
  - [ ] Скрывается если count = 0

---

### TASK-063: mark-as-read on chat focus

- **Phase:** 7
- **Tokens:** ~15k
- **Outputs:**
  - `src/features/events/useMarkAsRead.ts` (хук, вызываемый в ChatRoute при mount)
- **Depends on:** TASK-061
- **Acceptance:**
  - [ ] При открытии чата → POST /event/.../readed/{id}
  - [ ] Оптимистично сбрасывает badge в UI

---

## Phase 8 — Media

### TASK-070: media/api.ts

- **Phase:** 8
- **Tokens:** ~20k
- **Outputs:**
  - `src/features/media/api.ts` (uploadMedia с progress, downloadMedia, listMedia, deleteMedia)
  - `src/features/media/model.ts` (MediaAttachment interfaces)
- **Depends on:** TASK-013
- **Parallel with:** TASK-040, TASK-050, TASK-060
- **Acceptance:**
  - [ ] uploadMedia принимает onProgress callback

---

### TASK-071: encryptFile + upload pipeline

- **Phase:** 8
- **Tokens:** ~50k
- **Outputs:**
  - `src/features/media/pipeline.ts` (encryptAndUpload(file, recipients, signingKey) → media_id, retry 3x)
- **Depends on:** TASK-070, TASK-012
- **Acceptance:**
  - [ ] Файл > 50 MB отклоняется до шифрования
  - [ ] Параллельная загрузка нескольких файлов через Promise.all

---

### TASK-072: decryptFile + download pipeline

- **Phase:** 8
- **Tokens:** ~35k
- **Outputs:**
  - `src/features/media/decrypt.ts` (decryptAndCache(mediaId, sendersKey, recipientsKey) → blob URL)
  - `src/features/media/cache.ts` (in-memory LRU cache blob URLs)
- **Depends on:** TASK-070, TASK-012
- **Acceptance:**
  - [ ] Скачивание ленивое (только по клику)
  - [ ] blob URL revoke после показа

---

### TASK-073: MediaPreview component

- **Phase:** 8
- **Tokens:** ~30k
- **Outputs:**
  - `src/features/media/components/MediaPreview.tsx` (для image — img, для других — file icon + size + download button)
- **Depends on:** TASK-072
- **Acceptance:**
  - [ ] Image preview расшифровывается при попадании в viewport (IntersectionObserver)

---

### TASK-074: progress UI

- **Phase:** 8
- **Tokens:** ~15k
- **Outputs:**
  - `src/features/media/components/UploadProgress.tsx` (Mantine Progress с файлами и общим прогрессом)
- **Depends on:** TASK-071
- **Acceptance:**
  - [ ] Показывает per-file и total

---

## Phase 9 — Settings + Lock

### TASK-080: settingsStore (расширение TASK-024)

- **Phase:** 9
- **Tokens:** ~10k
- **Outputs:**
  - дополнить `settingsStore.ts` полями `idleTimeoutMs`, `autoLockEnabled`
- **Depends on:** TASK-024
- **Acceptance:**
  - [ ] Значения по умолчанию: desktop 5min, mobile 1min

---

### TASK-081: SettingsRoute page

- **Phase:** 9
- **Tokens:** ~40k
- **Outputs:**
  - `src/routes/SettingsRoute.tsx` (вкладки: Profile, Keys, Appearance, About)
- **Depends on:** TASK-080, TASK-034
- **Acceptance:**
  - [ ] Theme picker работает
  - [ ] Language picker работает

---

### TASK-082: change public key UI

- **Phase:** 9
- **Tokens:** ~25k
- **Outputs:**
  - `src/features/settings/ChangeKeyTab.tsx` (форма импорта нового armored public key + POST /auth/change-public-key)
- **Depends on:** TASK-081, TASK-014
- **Acceptance:**
  - [ ] multipart/form-data с text/plain

---

### TASK-083: export keystore UI

- **Phase:** 9
- **Tokens:** ~20k
- **Outputs:**
  - `src/features/settings/ExportKeystoreTab.tsx` (кнопка «Экспорт», save dialog, копия keystore.qks)
- **Depends on:** TASK-010, TASK-014
- **Acceptance:**
  - [ ] Save dialog с фильтром `.qks`

---

### TASK-084: idle timeout → lock screen

- **Phase:** 9
- **Tokens:** ~30k
- **Outputs:**
  - `src/features/auth/useIdleTimeout.ts` (хук с таймером + listeners на mouse/key события)
  - обновить `App.tsx`: при lock → рендер `<LockScreen />`
- **Depends on:** TASK-080, TASK-021
- **Acceptance:**
  - [ ] Через 5 мин (desktop) / 1 мин (mobile) неактивности → lock

---

## Phase 10 — Mobile

### TASK-090: tauri.conf.json Android config

- **Phase:** 10
- **Tokens:** ~20k
- **Outputs:**
  - `src-tauri/tauri.conf.json` (bundle.android, identifier, version)
  - `src-tauri/gen/android/app/src/main/AndroidManifest.xml` (если требуется правка)
- **Depends on:** TASK-100
- **Acceptance:**
  - [ ] `tauri android build --apk` стартует

---

### TASK-091: notifications channel

- **Phase:** 10
- **Tokens:** ~30k
- **Outputs:**
  - `src/features/notifications/index.ts` (createNotification, setupChannel)
  - `src-tauri/src/commands/notify.rs` (новая Rust-команда, если нужен мост)
- **Depends on:** TASK-061, TASK-090
- **Acceptance:**
  - [ ] При новом сообщении вне чата → notification

---

### TASK-092: deep-link handler

- **Phase:** 10
- **Tokens:** ~20k
- **Outputs:**
  - `src/infra/deepLink.ts` (слушает `quant://chat/{id}`, navigate в Router)
- **Depends on:** TASK-025, TASK-090
- **Acceptance:**
  - [ ] `tauri://chat/abc-123` → navigate на /chats/abc-123

---

### TASK-093: lifecycle events (pause/resume)

- **Phase:** 10
- **Tokens:** ~20k
- **Outputs:**
  - `src/infra/lifecycle.ts` (подписка на onPause/onResume через tauri events)
  - обновить `useEventsPolling` (TASK-061) для mobile lifecycle
- **Depends on:** TASK-061, TASK-090
- **Acceptance:**
  - [ ] App в фоне → polling pause

---

### TASK-094: Android manifest hardening

- **Phase:** 10
- **Tokens:** ~12k
- **Outputs:**
  - `src-tauri/gen/android/app/src/main/AndroidManifest.xml` (allowBackup=false, exported=true для deep-link)
- **Depends on:** TASK-090
- **Acceptance:**
  - [ ] adb backup возвращает ошибку

---

## Phase 10.5 — Rust commands

### TASK-100: Cargo.toml + capabilities

- **Phase:** 10.5
- **Tokens:** ~25k
- **Outputs:**
  - `src-tauri/Cargo.toml` (tauri 2 с android feature, plugins)
  - `src-tauri/capabilities/default.json` (разрешения для плагинов)
- **Depends on:** TASK-001
- **Parallel with:** TASK-101
- **Acceptance:**
  - [ ] `tauri build` компилируется

---

### TASK-101: lib.rs setup

- **Phase:** 10.5
- **Tokens:** ~20k
- **Outputs:**
  - `src-tauri/src/lib.rs` (register всех плагинов, mobile entry)
  - `src-tauri/src/mobile.rs`
- **Depends on:** TASK-100
- **Parallel with:** TASK-100
- **Acceptance:**
  - [ ] `cargo build` без warnings

---

### TASK-102: get_app_data_dir command

- **Phase:** 10.5
- **Tokens:** ~12k
- **Outputs:**
  - `src-tauri/src/commands/app_data.rs`
- **Depends on:** TASK-101
- **Parallel with:** TASK-103, TASK-104
- **Acceptance:**
  - [ ] Возвращает PathBuf на desktop и Android

---

### TASK-103: lock_screen_now command

- **Phase:** 10.5
- **Tokens:** ~15k
- **Outputs:**
  - `src-tauri/src/commands/lock.rs` (emit 'app://lock' event)
- **Depends on:** TASK-101
- **Parallel with:** TASK-102, TASK-104
- **Acceptance:**
  - [ ] WebView получает событие

---

### TASK-104: log_frontend_error command

- **Phase:** 10.5
- **Tokens:** ~12k
- **Outputs:**
  - `src-tauri/src/commands/log.rs` (с фильтром чувствительных полей)
- **Depends on:** TASK-101
- **Parallel with:** TASK-102, TASK-103
- **Acceptance:**
  - [ ] Логи пишутся в stderr

---

## Phase 11 — i18n + theme

### TASK-110: i18n setup (en/ru)

- **Phase:** 11
- **Tokens:** ~25k
- **Outputs:**
  - `src/i18n/index.ts` (конфиг i18next)
  - `src/i18n/locales/en.json`
  - `src/i18n/locales/ru.json`
  - обновить `main.tsx`: Suspense для загрузки локалей
- **Depends on:** TASK-003
- **Acceptance:**
  - [ ] `useTranslation('login')` возвращает строки

---

### TASK-111: language switcher

- **Phase:** 11
- **Tokens:** ~12k
- **Outputs:**
  - `src/ui/components/LanguageSwitcher.tsx`
- **Depends on:** TASK-110, TASK-024
- **Acceptance:**
  - [ ] Меняет язык в runtime

---

### TASK-112: theme switcher

- **Phase:** 11
- **Tokens:** ~12k
- **Outputs:**
  - обновить `ColorSchemeToggle.tsx` для записи в settingsStore
- **Depends on:** TASK-003, TASK-024
- **Acceptance:**
  - [ ] Выбор сохраняется между запусками

---

## Phase 12 — Testing

### TASK-120: vitest setup

- **Phase:** 12
- **Tokens:** ~15k
- **Outputs:**
  - `vitest.config.ts`
  - `tests/setup.ts`
- **Depends on:** TASK-001
- **Acceptance:**
  - [ ] `npm run test` стартует

---

### TASK-121: cryptoService unit tests

- **Phase:** 12
- **Tokens:** ~30k
- **Outputs:**
  - `tests/unit/keyring/encrypt.test.ts` (round-trip с фикстурой ключей)
- **Depends on:** TASK-012, TASK-120
- **Acceptance:**
  - [ ] 10+ кейсов, включая tampered signature

---

### TASK-122: secureStore unit tests

- **Phase:** 12
- **Tokens:** ~25k
- **Outputs:**
  - `tests/unit/secure-store/*.test.ts` (расширяет TASK-011)
- **Depends on:** TASK-011
- **Acceptance:**
  - [ ] Все edge cases покрыты

---

### TASK-123: apiClient MSW tests

- **Phase:** 12
- **Tokens:** ~30k
- **Outputs:**
  - `tests/unit/api/*.test.ts` (MSW handlers для каждого эндпоинта)
- **Depends on:** TASK-013, TASK-120
- **Acceptance:**
  - [ ] Покрыты 401, 422, 413, network error

---

### TASK-124: integration test (docker-compose)

- **Phase:** 12
- **Tokens:** ~35k
- **Outputs:**
  - `tests/integration/full-flow.test.ts`
  - `tests/integration/docker-compose.yml` (postgres + backend)
- **Depends on:** TASK-052, TASK-053
- **Acceptance:**
  - [ ] E2E flow register → chat → encrypt → decrypt работает

---

### TASK-125: playwright e2e

- **Phase:** 12
- **Tokens:** ~35k
- **Outputs:**
  - `tests/e2e/auth.spec.ts`
  - `tests/e2e/chat.spec.ts`
  - `playwright.config.ts`
- **Depends on:** TASK-042, TASK-053
- **Acceptance:**
  - [ ] `npm run test:e2e` зелёный на собранном desktop-приложении

---

## Phase 13 — CI/CD

### TASK-130: GitHub Actions matrix

- **Phase:** 13
- **Tokens:** ~25k
- **Outputs:**
  - `.github/workflows/ci.yml` (matrix ubuntu/macos/windows, jobs: lint, test, build)
- **Depends on:** TASK-120, TASK-100
- **Acceptance:**
  - [ ] На PR запускаются все jobs

---

### TASK-131: Release workflow

- **Phase:** 13
- **Tokens:** ~30k
- **Outputs:**
  - `.github/workflows/release.yml` (на tag → build desktop + Android, upload artifacts)
- **Depends on:** TASK-130
- **Acceptance:**
  - [ ] Тестовый tag создаёт release

---

## Сводная таблица

| Phase        | Задачи        | Parallel?       | Est. tokens/task |
| ------------ | ------------- | --------------- | ---------------- |
| 1 Bootstrap  | TASK-001..005 | частично        | 15–30k           |
| 2 Core infra | TASK-010..015 | да              | 15–50k           |
| 3 State      | TASK-020..025 | да              | 12–30k           |
| 4 Auth UI    | TASK-030..034 | да              | 15–45k           |
| 5 Chats      | TASK-040..045 | частично        | 15–35k           |
| 6 Messages   | TASK-050..055 | частично        | 15–45k           |
| 7 Events     | TASK-060..063 | частично        | 12–40k           |
| 8 Media      | TASK-070..074 | частично        | 12–50k           |
| 9 Settings   | TASK-080..084 | частично        | 10–40k           |
| 10 Mobile    | TASK-090..094 | частично        | 12–30k           |
| 10.5 Rust    | TASK-100..104 | да              | 12–25k           |
| 11 i18n      | TASK-110..112 | да              | 12–25k           |
| 12 Testing   | TASK-120..125 | частично        | 15–35k           |
| 13 CI/CD     | TASK-130..131 | последовательно | 25–30k           |

**Итого:** ~60 задач.

---

## Рекомендуемый порядок запуска

```
Batch 1 (1 субагент):  TASK-001
Batch 2 (4 параллельно): TASK-002, TASK-003, TASK-004, TASK-005
Batch 3 (4 параллельно): TASK-010, TASK-013, TASK-014, TASK-015
Batch 4 (1):             TASK-012 (depends on TASK-010)
Batch 5 (4 параллельно): TASK-020, TASK-021, TASK-023, TASK-024
Batch 6 (1):             TASK-025
Batch 7 (5 параллельно): TASK-030, TASK-031, TASK-032, TASK-033, TASK-034
... далее по карте зависимостей
```

Каждый батч — отдельный turn с параллельными вызовами subagent.
