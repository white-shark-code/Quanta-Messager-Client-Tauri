# 03 — Refresh-токены: проблема с UX

**Приоритет:** 🟡 medium
**Статус:** обходим на фронте (экран повторного ввода пароля)

---

## Проблема

В `server/src/authentication/services.py:139` время жизни bearer-токена — **1 час**:

```python
def get_database_strategy(...) -> DatabaseStrategy:
    return DatabaseStrategy(access_token_db, lifetime_seconds=3600)
```

`fastapi-users` поддерживает refresh-токены из коробки (через
`get_refresh_router` или `JWTRefreshStrategy`), но в `main.py:38-42` подключён
только `get_auth_router` — **без refresh**:

```python
app.include_router(
    fastapi_users.get_auth_router(auth_backend),
    prefix="/auth",
    tags=["auth"],
)
```

## Влияние на UX

Сейчас каждый час пользователь должен:

1. Запросить любой защищённый эндпоинт.
2. Получить `401 Unauthorized`.
3. Фронт перенаправляет на экран `/login`.
4. Пользователь вводит **пароль** (мы не храним его — см. ниже).
5. После успешного `/auth/login` keystore расшифровывается, новый токен сохраняется.

## Почему мы не храним пароль

В keystore хранится (см. дизайн фронта, `docs/design.md` §5.2):

- bearer-токен
- приватный PGP-ключ
- публичный PGP-ключ
- user info

**Пароль НЕ хранится.** Хранить пароль — нарушение zero-knowledge и угроза безопасности
(любой дамп памяти или файловой системы раскрывает пароль).

## Как обходим сейчас

- На 401 показываем экран `<UnlockAgainScreen>` с полем «пароль».
- Пользователь вводит пароль → фронт вызывает `POST /auth/login` → получает новый токен
  → перешифровывает keystore с тем же ключом (Argon2id от пароля даёт тот же ключ).
- Расшифрованный PrivateKey остаётся в памяти, не требуется повторный импорт.

**Минусы:**

- UX — раздражает каждый час.
- Не работает, если пользователь «забыл» пароль для keystore (но это и плюс: keystore
  нельзя открыть без пароля, даже имея доступ к файлу).

## Что просим

### Вариант A — Включить refresh-токены (минимум)

Подключить `fastapi_users.get_refresh_router()`:

```python
app.include_router(
    fastapi_users.get_refresh_router(),
    prefix="/auth",
    tags=["auth"],
)
```

И обновить стратегию:

```python
# authentication/services.py
bearer_transport = BearerTransport(tokenUrl="auth/login")
cookie_transport = CookieTransport(...)  # или hybrid

auth_backend = AuthenticationBackend(
    name="auth",
    transport=bearer_transport,
    get_strategy=get_database_strategy,
    get_refresh_strategy=get_refresh_database_strategy,
)
```

**На фронте:** при 401 пытаемся `POST /auth/refresh` с refresh-cookie/bearer;
если успех → повторяем оригинальный запрос; если fail → `<UnlockAgainScreen>`.

### Вариант B — Долгий JWT + sliding session

Один токен живёт 24 часа, при каждом успешном запросе сервер продлевает TTL.
Проще, но хуже отзывается (logout не сразу аннулирует).

## Затронутые файлы (когда будет)

- `server/src/authentication/services.py:139, 142-148`
- `server/src/main.py:38-42`
- `docs/api.md` — добавить `/auth/refresh`
- `docs/security.md` — обновить секцию про время жизни токенов
