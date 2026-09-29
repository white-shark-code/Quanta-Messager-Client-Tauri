# 02 — Групповой PGP-ключ: логическая ошибка в модели

**Приоритет:** 🔴 high
**Статус:** блокирует корректное E2E-шифрование в группах

---

## Проблема

В `server/src/messages/models.py:48-60` модель `GroupChat` имеет поле `public_key: bytes`:

```python
class GroupChat(BasicChat):
    __tablename__: str = "group_chats"

    users: Mapped[UUID] = relationship(...)
    public_key: Mapped[bytes] = mapped_column(nullable=False)
```

А в `server/src/messages/router.py:286-306` при создании группы в это поле
записывается **публичный ключ создателя**:

```python
@group_chats.post(path="/", response_model=DefaultDialogChat)
async def create_group_chat(
    new_chat: PostDialogChat,
    user: User = Depends(dependency=current_user_av),
    session: AsyncSession = Depends(dependency=get_async_session),
):
    if not user.public_key:
        raise HTTPException(
            status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
            detail="Need add public key",
        )

    # Создаем групповой чат
    new_group_chat = GroupChat(name=new_chat.name, public_key=user.public_key)
    ...
```

## Почему это некорректно

1. **Семантика нарушена.** `public_key` в контексте чата подразумевает «ключ шифрования
   для этого чата», а не «чей-то личный ключ». Сейчас фронт не понимает, что это
   `user.public_key` создателя, а не групповой ключ.

2. **Сервер проверяет подпись сообщений в группе по этому ключу** —
   посмотрите `server/src/messages/services.py:chech_signature_and_encryption`,
   она принимает один `bytes_public_key`. Но сообщения в группе подписываются **разными
   пользователями**, у каждого свой ключ. Текущая логика в
   `group_messages.create_group_message` (router.py:337-341) передаёт
   `user.public_key` (отправителя), а не `group_chat.public_key` — то есть поле
   `GroupChat.public_key` вообще не используется для верификации подписи.

3. **Шифрование «для группы».** В классической схеме группового E2E:
   - Создаётся **отдельный PGP-ключ на группу** (или используется Sender Keys / MLS).
   - Этот ключ шифруется индивидуально для каждого участника его публичным ключом.
   - Участник расшифровывает свою копию своим приватным ключом.

   Сейчас ничего из этого нет — поле `GroupChat.public_key` мертвое.

4. **Схема `DefaultDialogChat` отдаёт `public_key`, но фронт не знает, чей он.**
   В `docs/api.md:163` написано «Response / Ответ — DefaultDialogChat», но
   `GroupChat` и `DefaultDialogChat` — **разные схемы** (см. `schemas.py:140-152`),
   и `GroupChat` сейчас **не отдаётся ни одним эндпоинтом**, что тоже непоследовательно.

## Что просим

### Минимум (без изменения протокола шифрования)

1. **Удалить** поле `GroupChat.public_key` или пометить его `nullable=True, default=None`
   с явным комментарием «deprecated, не использовать».
2. **Создать отдельную схему** `GroupChatRead` (или поправить `DefaultDialogChat`)
   с полями `id, name, users: list[UUID], created_at, members: list[{id, email}]` —
   без `public_key`.
3. Обновить `docs/api.md` и `docs/architecture.md`.

### Идеально (правильная схема группового E2E)

Ввести полноценную модель:

```sql
CREATE TABLE group_keys (
    group_id     UUID PRIMARY KEY REFERENCES group_chats(id) ON DELETE CASCADE,
    public_key   BYTEA NOT NULL,           -- групповой PGP public key
    encrypted_private_keys JSONB NOT NULL  -- {user_id: armored_encrypted_private_group_key}
);
```

И отдельный эндпоинт:

- `POST /group-chat/{id}/rotate-key` — генерация нового группового ключа админом
  - перешифровка для всех текущих участников.
- `POST /group-chat/{id}/join/{user_id}` — добавление участника: админ шифрует
  групповой приватный ключ публичным ключом нового участника, добавляет в JSON.

Клиент при добавлении участника должен иметь **доступ к приватному групповому ключу**
в зашифрованном виде (расшифровывает своим приватным ключом), затем сохраняет
в keystore и использует для шифрования исходящих сообщений.

> Это уже серьёзный объём работы. Если такой объём сейчас не подъёмный — см. минимум
> выше и описание «обходного пути для MVP» ниже.

## Как обходим на фронте (временное решение для MVP)

Фронт не использует `GroupChat.public_key`. Все сообщения в группе шифруются так:

- Берём **все публичные ключи участников** (см. репорт #01 про batch-lookup).
- Шифруем сообщение для каждого участника индивидуально → получаем `N` копий.
- Подписываем **одной** подписью отправителя.
- Серверу отправляем... — а вот тут проблема: текущий API ожидает один `encrypted_message`,
  не `N` копий.

**Реально это означает, что групповые чаты в текущем виде API нерабочие для E2E.**

Фронт предлагает **две опции** на выбор:

### Вариант A — «для MVP обходимся» (небезопасно, но работает)

Каждое сообщение шифруется **отдельно для каждого участника**, на бекенде хранится
`N` копий. Модель `GroupMessage` расширяется полем `encrypted_for_members: JSONB`
вместо `encrypted_message: BYTEA`. Подпись одна на всех.

**Минус:** storage растёт линейно от числа участников, нет forward secrecy.

### Вариант B — «правильный групповой ключ»

См. секцию «Идеально» выше. Сложнее в реализации, но единственно правильный.

## Затронутые файлы

- `server/src/messages/models.py:48-60` — модель
- `server/src/messages/router.py:286-306, 309-388` — создание группы и сообщений
- `server/src/messages/schemas.py:140-152, 80-92` — схемы
- `server/src/authentication/schemas.py:54-60` — возможно, отдельная схема для ключа
- `docs/api.md` — обновить
- `docs/architecture.md` — описать модель
