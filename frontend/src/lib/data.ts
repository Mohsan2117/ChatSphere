import { CheckCheck, CircleDot, FileText, Image, Mic, ShieldAlert, Users } from "lucide-react";

export const chats = [
  {
    id: "private-1",
    name: "Maya Chen",
    avatar: "MC",
    type: "Private",
    preview: "Design review is done. Sending final files now.",
    time: "09:42",
    unread: 2,
    online: true
  },
  {
    id: "group-1",
    name: "Launch Squad",
    avatar: "LS",
    type: "Group",
    preview: "Hamza: Backend health check passed.",
    time: "09:30",
    unread: 5,
    online: true
  },
  {
    id: "private-2",
    name: "Ava Martins",
    avatar: "AM",
    type: "Private",
    preview: "Can you forward the media samples?",
    time: "Yesterday",
    unread: 0,
    online: false
  }
];

export const messages = [
  {
    id: "m1",
    author: "Maya",
    body: "I created the group, added roles, and uploaded the new avatar.",
    time: "09:31",
    mine: false,
    status: "seen"
  },
  {
    id: "m2",
    author: "You",
    body: "Perfect. I am checking read receipts and typing events now.",
    time: "09:34",
    mine: true,
    status: "delivered"
  },
  {
    id: "m3",
    author: "Maya",
    body: "The contacts search feels fast. Blocking and reporting are visible in profile actions.",
    time: "09:38",
    mine: false,
    status: "seen"
  },
  {
    id: "m4",
    author: "You",
    body: "Great. I will connect uploads to Supabase buckets after API auth is locked.",
    time: "09:40",
    mine: true,
    status: "sent"
  }
];

export const modules = [
  { label: "Private Chat", value: "1:1 messages", icon: CheckCheck },
  { label: "Groups", value: "Roles and invites", icon: Users },
  { label: "Media", value: "Images and files", icon: Image },
  { label: "Voice Notes", value: "Storage-ready", icon: Mic },
  { label: "Moderation", value: "Reports queue", icon: ShieldAlert },
  { label: "Documents", value: "Secure uploads", icon: FileText }
];

export const events = [
  "connect",
  "join_chat",
  "send_message",
  "typing",
  "delivered",
  "seen",
  "online",
  "new_message"
];

export const contacts = [
  { name: "Hamza Ali", status: "Online", meta: "Backend engineer" },
  { name: "Lina Torres", status: "Away", meta: "Product manager" },
  { name: "Noah Reed", status: "Blocked", meta: "Spam report pending" }
];

export const health = [
  { label: "Latency target", value: "<300ms", state: "ready" },
  { label: "Availability", value: "99.9%", state: "ready" },
  { label: "JWT auth", value: "Planned", state: "pending" },
  { label: "Rate limits", value: "Planned", state: "pending" }
];

export { CircleDot };
