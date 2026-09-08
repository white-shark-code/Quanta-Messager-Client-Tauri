export interface Chat {
  id: string;
  name: string;
}

export interface DialogChat extends Chat {
  user0: string;
  user1: string;
  create_at: string;
}

export interface GroupChat extends Chat {
  users: string;
  create_at: string;
}

export type AnyChat = DialogChat | GroupChat;

export interface CreateChatRequest {
  name: string;
  user: string;
}

export interface ListItems<T> {
  items: T[];
}
