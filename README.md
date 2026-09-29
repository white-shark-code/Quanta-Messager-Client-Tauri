# Quant Messenger — Desktop Frontend

> E2E-encrypted messenger client (Tauri + TypeScript + React).
> Client-side PGP via openpgp.js, zero-knowledge against server.
>
> Клиент E2E-зашифрованного мессенджера (Tauri + TypeScript + React).
> PGP на стороне клиента через openpgp.js, zero-knowledge относительно сервера.

**Status:** alpha (v0.1.0)
**License:** MIT

---

## Stack / Стек

| Component         | Technology               |
| ----------------- | ------------------------ |
| Shell / Оболочка  | Tauri 2                  |
| Language / Язык   | TypeScript 5 (strict)    |
| UI / Интерфейс    | React 18 + Mantine 7     |
| Build / Сборка    | Vite 5                   |
| State / Состояние | TanStack Query + Zustand |
| PGP               | openpgp.js 6             |

| Компонент | Технология               |
| --------- | ------------------------ |
| Оболочка  | Tauri 2                  |
| Язык      | TypeScript 5 (strict)    |
| Интерфейс | React 18 + Mantine 7     |
| Сборка    | Vite 5                   |
| Состояние | TanStack Query + Zustand |
| PGP       | openpgp.js 6             |

---

## Architecture / Архитектура

Frontend is a thin React layer wrapped in a Tauri shell. All crypto (PGP encrypt/decrypt/sign/verify) and secret storage happen on the client. The server only verifies signatures and stores encrypted blobs — it never sees plaintext.

Полная схема, диаграммы и принципы — в [`docs/design.md`](./docs/design.md).

Декомпозиция на субагент-задачи — в [`.agents/tasks.md`](./.agents/tasks.md).

Backend API reference — в [`../Quant/server/docs/api.md`](../Quant/server/docs/api.md).

---

## Prerequisites / Требования

### Host (this machine / этот хост)

| Tool                     | Required    | Status                         |
| ------------------------ | ----------- | ------------------------------ |
| Node.js                  | 20+         | ✅ 26.7.0                      |
| npm / pnpm / yarn        | any         | ✅ installed                   |
| Rust                     | 1.74+       | ✅ 1.98.0                      |
| webkit2gtk-4.1           | yes (Linux) | ✅ 2.52.6                      |
| gtk4, libsoup3           | yes         | ✅                             |
| libayatana-appindicator  | yes         | ✅                             |
| librsvg, patchelf        | yes         | ✅                             |
| gcc / clang / pkg-config | yes         | ✅                             |
| cargo-tauri              | yes         | ⚠️ install via npm (see below) |

| Инструмент               | Требуется  | Статус                            |
| ------------------------ | ---------- | --------------------------------- |
| Node.js                  | 20+        | ✅ 26.7.0                         |
| npm / pnpm / yarn        | любой      | ✅ установлен                     |
| Rust                     | 1.74+      | ✅ 1.98.0                         |
| webkit2gtk-4.1           | да (Linux) | ✅ 2.52.6                         |
| gtk4, libsoup3           | да         | ✅                                |
| libayatana-appindicator  | да         | ✅                                |
| librsvg, patchelf        | да         | ✅                                |
| gcc / clang / pkg-config | да         | ✅                                |
| cargo-tauri              | да         | ⚠️ установка через npm (см. ниже) |

### Android build (not used on this host)

The host is not configured for Android. To enable Android builds elsewhere:

- JDK 17 (`pacman -S jdk17-openjdk`)
- Android SDK (`cmdline-tools`, `platform-tools`, `platforms;android-34`, `build-tools;34.0.0`)
- Android NDK (`ndk;26.1.10909125`)
- rustup + Rust Android targets: `aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android`

Этот хост **не настроен** для Android. Для включения на другой машине:

- JDK 17 (`pacman -S jdk17-openjdk`)
- Android SDK (`cmdline-tools`, `platform-tools`, `platforms;android-34`, `build-tools;34.0.0`)
- Android NDK (`ndk;26.1.10909125`)
- rustup + Android-таргеты: `aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android`

---

## Quick Start / Быстрый старт

```bash
# 1. Install deps / Установить зависимости
npm install

# 2. Run dev server (Vite + Tauri) / Запустить dev-сервер
npm run dev:tauri
# → Vite at http://localhost:1420
# → Tauri window opens with the app
```

The first run will create `src-tauri/target/` (~2 GB) — give it time.

При первом запуске создаётся `src-tauri/target/` (~2 GB) — дайте ему время.

---

## Build / Сборка

### Desktop (Linux) — current host

```bash
npm run build:tauri
# Artifacts / Артефакты:
#   src-tauri/target/release/bundle/deb/*.deb
#   src-tauri/target/release/bundle/appimage/*.AppImage
#   src-tauri/target/release/bundle/rpm/*.rpm
```

### Android (not on this host) / Android (не на этом хосте)

```bash
# Prerequisites (one-time) / Предварительно (один раз)
# See "Android build" section above / См. секцию Android build выше

# Debug APK
npm run build:android

# Release AAB (for Play Store)
npm run build:android -- --aab
```

---

## Scripts / Скрипты

| Command                    | EN                          | RU                               |
| -------------------------- | --------------------------- | -------------------------------- |
| `npm run dev`              | Vite dev server only        | Только Vite dev-server           |
| `npm run dev:tauri`        | Vite + Tauri window         | Vite + окно Tauri                |
| `npm run build`            | Type check + Vite build     | Проверка типов + сборка Vite     |
| `npm run build:tauri`      | Production desktop build    | Прод-сборка desktop              |
| `npm run build:android`    | Android debug APK           | Android debug APK                |
| `npm run lint`             | ESLint flat config          | ESLint flat config               |
| `npm run format`           | Prettier write              | Prettier форматирование          |
| `npm run typecheck`        | `tsc --noEmit`              | `tsc --noEmit`                   |
| `npm run test`             | Vitest unit tests           | Vitest unit-тесты                |
| `npm run test:integration` | Vitest + local backend      | Vitest + локальный backend       |
| `npm run test:e2e`         | Playwright on built app     | Playwright на собранном app      |
| `npm run test:remote`      | Run all tests on dreamliner | Прогнать все тесты на dreamliner |

| Команда                    | EN                               | RU  |
| -------------------------- | -------------------------------- | --- |
| `npm run dev`              | Только Vite dev-server           | —   |
| `npm run dev:tauri`        | Vite + окно Tauri                | —   |
| `npm run build`            | Проверка типов + сборка Vite     | —   |
| `npm run build:tauri`      | Прод-сборка desktop              | —   |
| `npm run build:android`    | Android debug APK                | —   |
| `npm run lint`             | ESLint flat config               | —   |
| `npm run format`           | Prettier форматирование          | —   |
| `npm run typecheck`        | `tsc --noEmit`                   | —   |
| `npm run test`             | Vitest unit-тесты                | —   |
| `npm run test:integration` | Vitest + локальный backend       | —   |
| `npm run test:e2e`         | Playwright на собранном app      | —   |
| `npm run test:remote`      | Прогнать все тесты на dreamliner | —   |

---

## Project Structure / Структура проекта

```
Quant_tauri/
├── src/                        # React app / React-приложение
│   ├── main.tsx                # Entry point / Точка входа
│   ├── App.tsx
│   ├── routes/                 # React Router pages
│   ├── features/               # Bounded contexts
│   │   ├── auth/               # login/register/session
│   │   ├── keyring/            # openpgp.js wrapper
│   │   ├── secure-store/       # Argon2id + ChaCha20-Poly1305
│   │   ├── chats/              # dialogs + groups list
│   │   ├── messages/           # text messages, optimistic updates
│   │   ├── media/              # encrypted media attachments
│   │   └── events/             # polling unread events
│   ├── infra/                  # apiClient, tauriBridge, env, error
│   ├── ui/                     # design system on Mantine
│   └── lib/                    # utilities / утилиты
├── src-tauri/                  # Rust / Rust
│   ├── src/                    # commands, mobile entry
│   ├── capabilities/           # plugin permissions
│   ├── Cargo.toml
│   └── tauri.conf.json
├── tests/                      # test suites
│   ├── unit/                   # vitest
│   ├── integration/            # docker-compose with backend
│   ├── e2e/                    # playwright
│   └── Dockerfile              # test container
├── docs/
│   └── design.md               # full design doc
├── .agents/
│   ├── tasks.md                # subagent task breakdown
│   └── report_for_backend/     # backend team reports
├── docker-compose.test.yml     # full test stack
├── scripts/
│   └── test-remote.sh          # ssh to dreamliner
├── package.json
├── tsconfig.json               # strict: true
├── vite.config.ts
└── README.md                   # this file
```

---

## Testing / Тестирование

### Local unit tests / Локальные unit-тесты

```bash
npm run test                       # vitest, no backend needed
npm run test:watch                 # watch mode
```

### Local integration tests / Локальные интеграционные

Requires backend running locally (uses uv + sqlite, no Docker needed):

```bash
# Terminal 1: start backend / запустить backend
cd ../Quant/server
uv sync --extra sqlite
source .venv/bin/activate
cp .env.example .env  # configure DB_TYPE=sqlite
alembic upgrade head
uvicorn src.main:app --reload --port 8000

# Terminal 2: run integration tests / запустить тесты
VITE_API_URL=http://localhost:8000 npm run test:integration
```

### Remote E2E + full suite on `dreamliner` / Удалённые на dreamliner

All tests (unit + integration + e2e) run inside Docker containers on the remote host.
Все тесты (unit + integration + e2e) запускаются в Docker-контейнерах на удалённом хосте.

```bash
# One command / Одна команда
npm run test:remote
```

What it does / Что делает:

1. SSHs to `dreamliner` (preconfigured in `~/.ssh/config`)
2. Pulls latest changes
3. Builds test images: `postgres` + backend + `test-runner`
4. Runs `docker compose -f docker-compose.test.yml up --abort-on-container-exit`
5. Streams logs back to your terminal
6. Exits with the same code as the test-runner container

Подробности — в `scripts/test-remote.sh`. Сам скрипт настраивается через переменную окружения:

- `DREAM_PATH` — путь к проекту на dreamliner (default: `/home/VcR3S9/projects/Quant_tauri`)
- `DREAM_HOST` — alias в `~/.ssh/config` (default: `dreamliner`)

---

## Code Style / Стиль кода

```bash
npm run lint        # ESLint flat config (typescript, react, import, security)
npm run format      # Prettier write
npm run typecheck   # tsc --noEmit
```

Pre-commit (via lefthook) runs all three automatically.
Pre-commit (через lefthook) запускает все три автоматически.

Docstrings: bilingual EN first, then RU (matches backend convention).
Docstring'и: двуязычные — сначала EN, потом RU (как в backend).

---

## Security / Безопасность

Zero-knowledge model: server never sees plaintext or private keys. All PGP operations happen on the client. Private keys stored in an encrypted local file (`keystore.qks`, ChaCha20-Poly1305 + Argon2id).

Полный чеклист угроз — в [`docs/design.md` §10](./docs/design.md).

Модель zero-knowledge: сервер не видит plaintext и приватные ключи. Все PGP-операции — на клиенте. Приватные ключи хранятся в зашифрованном файле (`keystore.qks`, ChaCha20-Poly1305 + Argon2id).

---

## Documentation / Документация

- [`docs/design.md`](./docs/design.md) — full design document / полный дизайн-документ
- [`.agents/tasks.md`](./.agents/tasks.md) — subagent task breakdown / декомпозиция на субагент-задачи
- [`.agents/report_for_backend/`](./.agents/report_for_backend/) — backend team reports / отчёты для backend-команды
- [`../Quant/server/docs/api.md`](../Quant/server/docs/api.md) — backend API reference / справочник API бекенда
- [`../Quant/server/docs/security.md`](../Quant/server/docs/security.md) — security model / модель безопасности

---

## Roadmap / Дорожная карта

11-stage MVP plan from [`docs/design.md` §12](./docs/design.md):

1. Bootstrap (Tauri + Vite + Mantine)
2. Secure-store + keyring (Argon2id + openpgp.js)
3. Auth flow (login/register/unlock)
4. Chats list (private + groups)
5. Messages (text + optimistic)
6. Events polling (5s interval)
7. Media (encrypted attachments)
8. Settings + lock screen
9. Mobile polish (Android build, lifecycle, deep-link)
10. Hardening (CSP, virtualisation, security audit)
11. Docs & Release v0.1.0

**Android** — not enabled on this host; full build instructions in the Build section above.

11-этапный план MVP — в [`docs/design.md` §12](./docs/design.md).

**Android** — не включён на этом хосте; полные инструкции в секции Build выше.

---

## License / Лицензия

MIT — see [`LICENSE`](./LICENSE).

MIT — см. [`LICENSE`](./LICENSE).
