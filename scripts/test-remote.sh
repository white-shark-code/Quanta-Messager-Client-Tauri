#!/usr/bin/env bash
#
# Run the full test suite on the remote `dreamliner` host.
# Запускает полный набор тестов на удалённом хосте `dreamliner`.
#
# Configuration / Конфигурация (override via env vars):
#   DREAM_HOST — SSH alias (default: dreamliner)
#   DREAM_PATH — project path on remote (default: /home/VcR3S9/projects/Quant_tauri)
#   BRANCH     — git branch to test (default: current local branch)
#
# Examples / Примеры:
#   npm run test:remote
#   DREAM_PATH=/srv/quant npm run test:remote
#   BRANCH=feature/x DREAM_HOST=builder2 npm run test:remote
#
# Prerequisites / Требования:
#   - dreamliner must be configured in ~/.ssh/config
#   - dreamliner must have docker + docker compose installed
#   - dreamliner must have access to the backend repo at ../Quant/server

set -euo pipefail

DREAM_HOST="${DREAM_HOST:-dreamliner}"
DREAM_PATH="${DREAM_PATH:-/home/VcR3S9/projects/Quant_tauri}"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

# Colours for output / Цвета для вывода.
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}→ Running tests on ${DREAM_HOST}:${DREAM_PATH} (branch: ${BRANCH})${NC}"
echo -e "${YELLOW}→ Прогон тестов на ${DREAM_HOST}:${DREAM_PATH} (ветка: ${BRANCH})${NC}"

ssh "$DREAM_HOST" bash -s <<EOF
  set -euo pipefail
  cd "${DREAM_PATH}"

  echo "→ Pulling latest changes / Подтягиваем свежие изменения"
  git fetch origin
  git checkout "${BRANCH}"
  git pull --ff-only origin "${BRANCH}" || true

  echo "→ Building test images / Собираем тестовые образы"
  docker compose -f docker-compose.test.yml build --pull

  echo "→ Running tests / Запускаем тесты"
  docker compose -f docker-compose.test.yml up \\
    --abort-on-container-exit \\
    --exit-code-from test-runner \\
    --renew-anon-volumes

  RESULT=\$?

  echo "→ Cleaning up / Чистим за собой"
  docker compose -f docker-compose.test.yml down --remove-orphans

  exit \$RESULT
EOF

RESULT=$?

if [ $RESULT -eq 0 ]; then
  echo -e "${GREEN}✓ All tests passed on ${DREAM_HOST}${NC}"
  echo -e "${GREEN}✓ Все тесты прошли на ${DREAM_HOST}${NC}"
else
  echo -e "${RED}✗ Tests failed on ${DREAM_HOST} (exit ${RESULT})${NC}"
  echo -e "${RED}✗ Тесты упали на ${DREAM_HOST} (exit ${RESULT})${NC}"
  exit $RESULT
fi
