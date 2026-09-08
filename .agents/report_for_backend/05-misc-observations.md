# 05 — Различные наблюдения и предложения

**Приоритет:** 🟢 low
**Статус:** не блокирует MVP

> Коллекция мелких замечаний, найденных при анализе бекенда.

---

## 1. CORS не настроен

**Файл:** `server/src/main.py`

В `FastAPI()` создаётся приложение, но `CORSMiddleware` не подключён.
Для Tauri-приложения, которое делает запросы с `https://localhost:1420`
(или другого dev-origin) на бекенд `http://localhost:8000`, CORS нужен.

### Что просим

Добавить `CORSMiddleware` (в dev-режиме — `allow_origins=["*"]`, в prod — конкретные origins).

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["tauri://localhost", "http://localhost:1420"] if cfg.DEBUG else [...],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

> Альтернатива: использовать Tauri `tauri-plugin-http` с `unsafe-headers` фичей,
> которая отключает проверку CORS на desktop/Android. На фронте мы предпочитаем
> именно этот путь (см. дизайн §8.1) — но CORS всё равно стоит добавить для
> будущего веб-клиента и Swagger UI с другого origin.

---

## 2. Дублирование docstring в `main.py`

**Файл:** `server/src/main.py:1-23`

Docstring модуля продублирован дважды подряд (строки 1-11 и 13-23). Мелочь, но
`ruff` мог бы это поймать — если не поймал, посмотрите конфиг.

---

## 3. Несоответствие схемы `DefaultDialogChat`

**Файл:** `server/src/messages/schemas.py:80-92`

Поле называется `create_at`, но в `DialogChat` модели
(`server/src/messages/models.py:21-29`, наследует `AbstractModelWithCreateAt`)
используется `creation_datetime`. Это путает и клиента, и читателя кода.

### Что просим

Переименовать либо поле в схеме → `creation_datetime`, либо колонку в модели → `create_at`.
Рекомендую — **поле в схеме**, чтобы не ломать миграции.

---

## 4. Нет CORS / preflight для WebSocket (если будете добавлять)

Если в будущем добавите WebSocket-эндпоинт (для real-time вместо polling), учтите:
- `CORSMiddleware` обрабатывает только HTTP — для WS нужен отдельный `WSMiddleware`
  или передача заголовков origin вручную.
- Tauri-WebView на Android имеет лимит на одновременные WS-соединения.

---

## 5. `chech_signature_and_encryption` — опечатка

**Файл:** `server/src/messages/services.py:11`

Имя функции — `chech_...` (без `k` после `che`). Мелочь, но неприятно. Если
когда-нибудь будете делать рефакторинг — поправьте.

---

## 6. `event/dialog/readed/{event_id}` — странное название

**Файл:** `server/src/events/router.py:88, 127`

Эндпоинт называется `readed` (некорректный английский). Правильно — `read`
(POST `/event/dialog/read/{event_id}`).

Также странно, что эндпоинт **POST** без тела, когда это по смыслу «пометить
как прочитанное» — больше подходит PUT/PATCH. Но это уже вкусовщина.

---

## 7. Отсутствует `PATCH` для обновления чата

**Файл:** `server/src/messages/router.py:45-135`

Для приватных чатов есть GET/POST/DELETE, но нет PATCH. Если когда-нибудь
захотите дать пользователю переименовать чат — придётся добавлять.

---

## 8. Нет `last_message_at` в `DefaultDialogChat`

Сейчас список чатов нужно сортировать на фронте по `creation_datetime` чата
(время создания!), а не по последнему сообщению. Это даёт неправильный порядок
— новые сообщения в старом чате не поднимают его в списке.

### Что просим

Добавить в `DialogChat` и `GroupChat` поле `last_message_at: datetime | null`
(обновляется триггером или в `create_message`).

---

## 9. Нет пагинации для списка чатов

**Файл:** `server/src/messages/router.py:95-112`

`GET /private-chats/` возвращает **все** чаты пользователя. Для активного
пользователя с сотнями диалогов это может быть медленно. Стоит добавить
тот же `paggination` dependency, что используется для сообщений.

---

## 10. `paggination` — опечатка в имени параметра

**Файл:** `server/src/messages/router.py:140`

Параметр называется `paggination`, должно быть `pagination`. Используется в
нескольких местах.

---

## 11. Media upload не валидирует `file_size` на клиенте

**Файл:** `server/src/messages/router.py:409-414`

Проверка только `file_size > MAX_MEDIA_SIZE_BYTES`. Если клиент отправит
файл размером 100 GB — сервер всё равно прочитает его в память до проверки.
Стоит:

- либо проверять `Content-Length` header до чтения body,
- либо использовать streaming upload (`request.stream()`).

---

## 12. Нет документации OpenAPI для медиа-схем

**Файл:** `docs/api.md`, секция Media

Схемы `UploadMediaAttachment`, `MediaAttachmentResponse`, `MediaAttachmentDownload`
описаны в `schemas.py`, но не задокументированы в `docs/api.md`.
Все остальные схемы (`DefaultDialogChat`, `DialogMessage`, `EventInDialogChat`)
там есть — стоит дополнить.

---

## 13. `GroupChat.public_key` не NULL-able

**Файл:** `server/src/messages/models.py:59`

`public_key: Mapped[bytes] = mapped_column(nullable=False)`

См. репорт #02 — это поле логически некорректно. Должно быть либо
`nullable=True` (с пометкой deprecated), либо вообще удалено в свежей миграции.

---

## 14. Нет индекса на `dialog_messages.chat_id`

**Файл:** `server/src/messages/models.py:78-88`

Скорее всего индекс уже есть через `ForeignKey`, но явно не указан.
Для таблицы сообщений чата стоит иметь композитный индекс
`(chat_id, creation_datetime DESC)` для быстрой пагинации.

---

## 15. `current_user_av` с `verified=True if not cfg.DEBUG else False`

**Файл:** `server/src/authentication/services.py:155-156`

```python
current_user_av: callable = fastapi_users.current_user(
    active=True, verified=True if not cfg.DEBUG else False
)
```

В debug-режиме не требуется verified email. Это удобно для разработки, но
в `cfg.DEBUG` (см. `settings.py:81`) по умолчанию `True`! То есть
**в текущем коде verified не проверяется вообще**, потому что `DEBUG=True`
по умолчанию.

Это либо баг (забыли выключить DEBUG), либо осознанный выбор (но тогда
опасно — production может случайно стартовать с DEBUG=True).

### Что просим

- Сделать `DEBUG=False` по умолчанию.
- Добавить логирование на старте: «Running with DEBUG=True!» (warning).
- Возможно, запретить DEBUG в production через переменную окружения.

---

## Итог

Все пункты из этого документа не блокируют MVP фронтенда (мы их обходим на клиенте),
но было бы здорово почистить, если будет заход на рефакторинг.
