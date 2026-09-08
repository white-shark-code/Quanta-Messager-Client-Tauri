export interface DialogEvent {
  id: string;
  chat_id: string;
  user_id: string;
  count: number;
}

export interface GroupEvent {
  id: string;
  chat_id: string;
  user_id: string;
  count: number;
}

export interface ListItems<T> {
  items: T[];
}
