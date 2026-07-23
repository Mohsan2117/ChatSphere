export type ChatSeed = {
  id: string;
  name: string;
  avatar: string;
  color: string;
  preview: string;
  time: string;
  unread: number;
  online: boolean;
};

export const chats: ChatSeed[] = [];
