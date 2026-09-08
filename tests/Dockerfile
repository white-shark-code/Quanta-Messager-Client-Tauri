# Test runner image for the Quant frontend.
# Used by docker-compose.test.yml on the dreamliner host.
#
# Образ для прогона тестов Quant-фронтенда.
# Используется в docker-compose.test.yml на хосте dreamliner.

# Base: official Playwright image with all browser deps + Chromium pre-installed.
# База: официальный образ Playwright со всеми зависимостями браузеров + предустановленный Chromium.
FROM mcr.microsoft.com/playwright:v1.50.0-jammy AS base

# ---- Builder stage ----
# Install npm dependencies in a separate layer for better caching.
# Установка npm-зависимостей в отдельный слой для лучшего кеширования.
FROM base AS builder
WORKDIR /app

# Copy package files first to leverage Docker layer cache.
# Сначала копируем package-файлы для кеша слоёв.
COPY package.json package-lock.json* ./
COPY tsconfig.json vite.config.ts eslint.config.js .prettierrc.json lefthook.yml* ./

RUN npm ci --no-audit --no-fund

# Copy source code.
# Копируем исходный код.
COPY src ./src
COPY src-tauri ./src-tauri
COPY tests ./tests
COPY public ./public
COPY index.html ./

# Type-check and build Vite bundle (needed for e2e).
# Проверка типов и сборка Vite-бандла (нужно для e2e).
RUN npm run typecheck && npm run build

# ---- Runtime stage ----
# Smaller image with only what's needed to run tests.
# Меньший образ — только то, что нужно для тестов.
FROM base AS runtime
WORKDIR /app

# Copy built artifacts from builder.
# Копируем артефакты сборки из builder.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/tests ./tests
COPY --from=builder /app/src-tauri ./src-tauri
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/vite.config.ts ./vite.config.ts
COPY --from=builder /app/index.html ./index.html

# Default command is overridden by docker-compose.
# Дефолтная команда переопределяется в docker-compose.
CMD ["npm", "test"]
