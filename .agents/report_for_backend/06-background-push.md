# 06 — Фоновые уведомления: Web Push (B), демон/трей (C), FCM/APNs (D)

**Приоритет:** 🟡 medium (A уже работает: непрочитанные видны при открытии)
**Статус:** на согласовании, фронт готов к своей части

---

## Контекст

Фронт подключил realtime WS (`GET /event/ws?token=`, пуши `new_dialog_message` /
`new_group_message`, `ping→pong`, `4401` на плохой токен) — проверено вживую
в обе стороны: браузер → сокет пира и обратно, E2E-шифрование и подписи целы.

Но сокет жив только пока жив JS-контекст. Закрыта вкладка / убит WebView —
уведомлений нет. Непрочитанные не теряются (счётчики `EventInDialogChat` /
`EventInGroupChat` в БД), но «вживую» ничего не прилетает. Ниже — что нужно
от бэкенда для трёх фоновых каналов. Фронт свою часть берёт на себя.

## Сквозные требования (ко всем пунктам)

1. **Никакого шифротекста и текста сообщений в пушах.** E2E: сервер текстов
   не видит. Пейлоад — только метаданные (см. схемы ниже).
2. **Контент по настройке юзера** (хранится на фронте, бэк шлёт оба поля):
   - `generic` (дефолт): «Новое сообщение», без имён;
   - `sender`: плюс `chat_name` / `sender_name`.
     Фронт сам выберет, что показать. Бэк отдаёт оба поля всегда.
3. **Best-effort доставка.** Ошибка пуша никогда не роняет `POST` сообщения
   (как сейчас `manager.send_to_user` в `messages/router.py`).
4. **Проблема веера (важно!).** `ConnectionManager` — in-memory на процесс.
   При 2+ воркерах uvicorn WS-пуш может уйти не туда. Для B и D это не
   критично (пуш идёт мимо WS, напрямую в `create_message`), для C —
   желательно решить: Redis pub/sub для событий либо sticky-роутинг WS.
   Просим подтвердить выбранный вариант.

---

## B. Web Push (закрытая вкладка, браузер запущен)

Chrome/Edge/Firefox desktop показывают нотификацию из Service Worker,
даже если вкладка закрыта. iOS — не поддерживается, это ок.

### Нужно от бэкенда

**Таблица `push_subscriptions`:**

```sql
user_id UUID, endpoint TEXT UNIQUE, p256dh TEXT, auth TEXT, created_at TIMESTAMPTZ
```

**Эндпоинты (auth required):**

- `POST /push/subscribe` — `{endpoint, keys: {p256dh, auth}}` → upsert по
  `(user_id, endpoint)`. Ответ `201` / `200`.
- `DELETE /push/unsubscribe` — `{endpoint}` → `204` (идемпотентно).

**VAPID:**

- `VAPID_PUBLIC_KEY` отдавать в `GET /meta` (фронт им подписывает SW).
- `VAPID_PRIVATE_KEY` + `VAPID_CLAIMS_SUB` (`mailto:`) — только в env сервера.

**Отправка:** в `create_message` (рядом с `manager.send_to_user`), получателям
кроме отправителя, через `pywebpush`. Пейлоад:

```json
{
  "type": "new_dialog_message",
  "chat_id": "uuid",
  "message_id": "uuid",
  "sender_name": "string|null",
  "chat_name": "string|null"
}
```

TTL ~2419200 (4 недели), urgency `normal`. `410 Gone` / `404` от push-сервиса
→ удалять подписку. Ошибки сети → `debug`-лог, запрос не ронять.

**Приёмка B:** вкладка закрыта, браузер запущен → сообщение → ОС-нотификация;
клик открывает чат; отписка чистит запись; `410` чистится сервером.

---

## C. Демон/трей (десктоп, в т.ч. dwm без трея)

У части пользователей dwm — трея нет в принципе. Поэтому фронт делает
`quantd` (headless Rust-демон с persistent WS + `org.freedesktop.Notifications`
через dunst) основным путём, трей — только где он есть.

### Нужно от бэкенда

Строго говоря — **ничего нового**, если выполнен п.4 (веер): демон — обычный
WS-клиент `/event/ws?token=`, бэкенд уже умеет `user_id → set[WebSocket]`
(два сокета одного юзера — UI + демон — получают пуш оба, это ок).

Просьба подтвердить два момента:

1. Формат `?token=` и `4401`-семантика стабильны (демон на них завязан:
   `4401` → запросить пароль keystore заново, не долбить реконнектом).
2. Нет серверного таймаута на молчащий сокет (пинг демона — раз в ~25–60с;
   если сервер начнёт кикать idle — скажите, подстроим интервал).

**Приёмка C:** приложение «закрыто», `quantd` в процессах → сообщение →
dunst-нотификация; клик открывает чат.

---

## D. Мобильный push FCM/APNs (будит убитое приложение)

Самый тяжёлый пункт, единственный, который будит полностью убитое приложение.

### Нужно от бэкенда

**Таблица `devices`:**

```sql
user_id UUID, platform TEXT, push_token TEXT UNIQUE, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

**Эндпоинты (auth required):**

- `POST /devices/register` — `{platform: "android"|"ios", push_token}` →
  upsert по `(user_id, push_token)`. Ответ `200`.
- `DELETE /devices/unregister` — `{push_token}` → `204` (на logout).

**Отправка:** в `create_message`, получателям кроме отправителя, через FCM
(Android; iOS — APNs напрямую либо через FCM). Только **data-сообщения**
(без `notification` — показ делает клиент локально, иначе дубли):

```json
{
  "type": "new_dialog_message",
  "chat_id": "uuid",
  "message_id": "uuid",
  "sender_name": "string|null",
  "chat_name": "string|null"
}
```

`NotRegistered` / `InvalidRegistration` → удалять токен. Секреты
(FCM service-account / APNs key) — только в env, не в репо.

**Приёмка D:** приложение убито (swipe away) → сообщение → системный пуш →
тап открывает чат с расшифровкой.

---

## Что сделает фронт (для сведения, не требует бэкенда)

- Настройки: `pushEnabled`, `backgroundMode: off|daemon|tray`,
  `notificationContent: generic|sender` (дефолт `generic`).
- B: Service Worker + подписка + клик открывает чат.
- C: `quantd`, XDG-autostart / `systemd --user`, опциональный модуль
  счётчика для dwmblocks, правило «не дублировать, если UI в фокусе».
- D: получение FCM-токена → `register` на login/unlock, локальный `notify()`
  (уже есть, Android-safe) при входе data-пуша.

## Открытые вопросы к бэкенду

1. Берёте B и D в работу? Если да — в каком порядке и какие сроки?
2. Веер при мульти-воркерах (п.4): Redis pub/sub, sticky, или пока один воркер?
3. VAPID/FCM/APNs-секреты: кто генерирует и где хранятся?
4. Подтвердить стабильность `?token=` / `4401` / отсутствие idle-таймаута (п.C).
