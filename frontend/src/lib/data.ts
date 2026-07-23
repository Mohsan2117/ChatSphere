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

export type DirectoryUser = {
  id: string;
  email: string;
  firstName: string;
  lastName?: string;
  avatarUrl?: string;
};

export function userToChat(user: DirectoryUser): ChatSeed {
  const name = `${user.firstName} ${user.lastName ?? ""}`.trim() || user.email;
  return {
    id: user.id,
    name,
    avatar: initials(name),
    color: "bg-[#0f766e]",
    preview: user.email,
    time: "",
    unread: 0,
    online: false
  };
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "U"}${parts[1]?.[0] ?? ""}`.toUpperCase();
}
