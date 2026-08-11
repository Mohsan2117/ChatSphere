"use client";

import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  CheckCheck,
  FileText,
  Image,
  Loader2,
  LogOut,
  MessageCircle,
  MoreVertical,
  Paperclip,
  Mail,
  Search,
  Send,
  ShieldCheck,
  Smile,
  Upload,
  UserPlus,
  Users
} from "lucide-react";
import { ChatSeed, DirectoryUser, userToChat } from "@/lib/data";
import EmojiPicker, { EmojiClickData, Theme } from "emoji-picker-react";
import { AIChat } from "@/components/AIChat";

type AuthStep = "signup" | "login" | "code" | "profile" | "forgot" | "reset-code" | "reset-password";
type ChatMessage = {
  id: string;
  body: string;
  time: string;
  mine: boolean;
  senderEmail?: string;
  senderId?: string;
  recipientId?: string;
  createdAt?: string;
  readAt?: string | null;
  attachment?: {
    name: string;
    type: string;
    url: string;
    kind: "image" | "video" | "file";
  };
  localSeq?: number;
};
type AttachmentDraft = NonNullable<ChatMessage["attachment"]> & { file?: File };
type ChatDraft = {
  text: string;
  attachment: AttachmentDraft | null;
};
type ChatDraftStore = Record<string, ChatDraft>;
type MessageStore = Record<string, ChatMessage[]>;
type WorkspaceMode = "inbox" | "search" | "contacts" | "files" | "ai";
type AdminUser = {
  id: string;
  email: string;
  firstName: string;
  lastName?: string;
  blocked?: boolean;
  createdAt?: string;
};
type AdminReport = {
  id: string;
  reporterId: string;
  reportedId: string;
  messageId?: string;
  reason: string;
  status: string;
  reporterName?: string;
  reportedName?: string;
  createdAt?: string;
};

export function AppShell() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [authStep, setAuthStep] = useState<AuthStep>("signup");
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [adminError, setAdminError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminReports, setAdminReports] = useState<AdminReport[]>([]);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  const [drafts, setDrafts] = useState<ChatDraftStore>({});
  const [isEmojiOpen, setIsEmojiOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<MessageStore>({});
  const [directoryChats, setDirectoryChats] = useState<ChatSeed[]>([]);
  const [selectedChatSnapshot, setSelectedChatSnapshot] = useState<ChatSeed | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("inbox");
  const [isChatSearchOpen, setIsChatSearchOpen] = useState(false);
  const [chatMessageSearch, setChatMessageSearch] = useState("");
  const [isChatMenuOpen, setIsChatMenuOpen] = useState(false);
  const [blockedChatIds, setBlockedChatIds] = useState<string[]>([]);
  const [isClearingChat, setIsClearingChat] = useState(false);
  const [chatNotice, setChatNotice] = useState("");
  const [socketAttempt, setSocketAttempt] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const chatSearchRef = useRef<HTMLInputElement | null>(null);
  const chatMessageSearchRef = useRef<HTMLInputElement | null>(null);
  const selectedChatIdRef = useRef(selectedChatId);
  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const userIsNearBottomRef = useRef(true);
  const prevMessagesLengthRef = useRef(0);
  const prevChatIdRef = useRef("");

  const pendingSendQueueRef = useRef<{
    chatId: string;
    message: ChatMessage;
    draftText: string;
    draftAttachment: AttachmentDraft | null;
  }[]>([]);
  const isProcessingQueueRef = useRef(false);

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  };

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 150;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    userIsNearBottomRef.current = nearBottom;
  };
  const [isMobileAIChatOpen, setIsMobileAIChatOpen] = useState(false);
  const [isInboxLoading, setIsInboxLoading] = useState(true);
  const [isDirectoryLoading, setIsDirectoryLoading] = useState(true);
  const [inboxError, setInboxError] = useState("");
  const [directoryError, setDirectoryError] = useState("");
  const [isRestoring, setIsRestoring] = useState(true);

  const knownChats = useMemo(() => {
    const byId = new Map(directoryChats.map((chat) => [chat.id, chat]));
    Object.entries(chatMessages).forEach(([chatId, messages]) => {
      if (byId.has(chatId)) return;
      const lastMessage = messages.at(-1);
      const fallbackName = lastMessage?.senderId === chatId && lastMessage.senderEmail
        ? nameFromEmail(lastMessage.senderEmail)
        : "Conversation";
      byId.set(chatId, {
        id: chatId,
        name: fallbackName,
        avatar: chatInitials(fallbackName),
        color: "bg-[#0f766e]",
        preview: lastMessage?.body || lastMessage?.attachment?.name || "Saved conversation",
        time: lastMessage?.time ?? "",
        unread: 0,
        online: false
      });
    });
    if (selectedChatSnapshot && !byId.has(selectedChatSnapshot.id)) {
      byId.set(selectedChatSnapshot.id, selectedChatSnapshot);
    }
    return Array.from(byId.values());
  }, [chatMessages, directoryChats, selectedChatSnapshot]);

  const searchResults = useMemo(() => {
    const query = chatSearch.trim().toLowerCase();
    if (!query) return [];
    return directoryChats.filter((chat) => `${chat.name} ${chat.preview}`.toLowerCase().includes(query));
  }, [chatSearch, directoryChats]);
  const selectedChat = useMemo(() => knownChats.find((chat) => chat.id === selectedChatId), [knownChats, selectedChatId]);
  const selectedChatBlocked = selectedChatId ? blockedChatIds.includes(selectedChatId) : false;
  const currentMessageDraft = selectedChatId ? (drafts[selectedChatId]?.text ?? "") : "";
  const currentAttachmentDraft = selectedChatId ? (drafts[selectedChatId]?.attachment ?? null) : null;
  const selectedMessages = selectedChatId ? (chatMessages[selectedChatId] ?? []) : [];
  const visibleSelectedMessages = useMemo(() => {
    const query = chatMessageSearch.trim().toLowerCase();
    if (!query) return selectedMessages;
    return selectedMessages.filter((message) =>
      `${message.body} ${message.attachment?.name ?? ""}`.toLowerCase().includes(query)
    );
  }, [chatMessageSearch, selectedMessages]);
  const inboxChats = useMemo(() => {
    return knownChats
      .filter((chat) => (chatMessages[chat.id] ?? []).length > 0)
      .sort((first, second) => {
        const firstMessages = chatMessages[first.id] ?? [];
        const secondMessages = chatMessages[second.id] ?? [];
        return (secondMessages.at(-1)?.id ?? "").localeCompare(firstMessages.at(-1)?.id ?? "");
      });
  }, [chatMessages, knownChats]);
  const unreadByChat = useMemo(() => {
    return Object.fromEntries(
      Object.entries(chatMessages).map(([chatId, messages]) => [
        chatId,
        messages.filter((message) => !message.mine && !message.readAt).length
      ])
    ) as Record<string, number>;
  }, [chatMessages]);
  const contactResults = useMemo(() => {
    const query = chatSearch.trim().toLowerCase();
    if (!query) return directoryChats;
    return directoryChats.filter((chat) => `${chat.name} ${chat.preview}`.toLowerCase().includes(query));
  }, [chatSearch, directoryChats]);
  const userInitials = useMemo(() => initials(firstName, lastName), [firstName, lastName]);
  const attachedMessages = useMemo(() => {
    return Object.entries(chatMessages).flatMap(([chatId, messages]) =>
      messages
        .filter((message) => message.attachment)
        .map((message) => ({
          chat: knownChats.find((chat) => chat.id === chatId),
          message
        }))
    );
  }, [chatMessages, knownChats]);
  const workspaceTitle = {
    inbox: "Chats",
    search: "Search",
    contacts: "Users",
    files: "Documents",
    ai: "AI Assistant"
  }[workspaceMode];

  useEffect(() => {
    const savedAdminToken = window.localStorage.getItem("chatsphere-admin-token") ?? "";
    if (savedAdminToken) {
      setAdminToken(savedAdminToken);
      setIsAdmin(true);
      setIsRestoring(false);
      return;
    }

    const hasVerifiedEmail = window.localStorage.getItem("chatsphere-auth") === "true";
    const hasProfile = window.localStorage.getItem("chatsphere-profile-complete") === "true";
    const savedEmail = window.localStorage.getItem("chatsphere-email");
    const savedUserId = window.localStorage.getItem("chatsphere-user-id");
    const savedToken = window.localStorage.getItem("chatsphere-token") ?? "";
    const savedProfile = window.localStorage.getItem("chatsphere-profile");

    if (savedEmail) setEmail(savedEmail);
    if (savedUserId) setCurrentUserId(savedUserId);
    if (savedToken) setAuthToken(savedToken);
    if (savedProfile) {
      try {
        const profile = JSON.parse(savedProfile) as { firstName?: string; lastName?: string; avatarPreview?: string };
        setFirstName(profile.firstName ?? "");
        setLastName(profile.lastName ?? "");
        setAvatarPreview(profile.avatarPreview ?? "");
      } catch {
        window.localStorage.removeItem("chatsphere-profile");
      }
    }
    if (!hasProfile) {
      const savedDraft = window.localStorage.getItem("chatsphere-onboarding-draft");
      if (savedDraft) {
        try {
          const draft = JSON.parse(savedDraft) as { firstName?: string; lastName?: string };
          setFirstName(draft.firstName ?? "");
          setLastName(draft.lastName ?? "");
        } catch {
          window.localStorage.removeItem("chatsphere-onboarding-draft");
        }
      }
    }
    setIsAuthed(hasVerifiedEmail && hasProfile && Boolean(savedToken));
    if (hasVerifiedEmail && !hasProfile) setAuthStep("profile");
    setIsRestoring(false);
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    setSelectedChatId("");
    setSelectedChatSnapshot(null);
    setChatSearch("");
  }, [isAuthed]);

  useEffect(() => {
    setIsEmojiOpen(false);
  }, [selectedChatId]);

  useEffect(() => {
    if (!isAdmin || !adminToken) return;
    loadAdminUsers(adminToken);
    loadAdminReports(adminToken);
  }, [adminToken, isAdmin]);

  useEffect(() => {
    if (!isAuthed || !authToken || !selectedChatId) return;

    const chatId = selectedChatId;
    let cancelled = false;
    fetch(`${apiUrl()}/api/v1/messages/${chatId}`, {
      headers: authHeaders(authToken)
    })
      .then((response) => {
        if (!response.ok) throw new Error("Conversation could not be loaded");
        return response.json();
      })
      .then((data) => {
        if (cancelled || chatId !== selectedChatIdRef.current) return;
        const messages = Array.isArray(data.messages) ? data.messages : [];
        setChatMessages((current) => {
          const existing = current[chatId] ?? [];
          if (messages.length === 0 && existing.length > 0) return current;
          return {
            ...current,
            [chatId]: mergeMessages(existing, messages)
          };
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [authToken, isAuthed, selectedChatId]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !selectedChatId) return;

    const messages = chatMessages[selectedChatId] ?? [];
    const prevLength = prevMessagesLengthRef.current;
    const prevChatId = prevChatIdRef.current;

    prevMessagesLengthRef.current = messages.length;
    prevChatIdRef.current = selectedChatId;

    if (selectedChatId !== prevChatId) {
      userIsNearBottomRef.current = true;
      scrollToBottom();
      const timer = setTimeout(() => scrollToBottom(), 50);
      return () => clearTimeout(timer);
    }

    if (messages.length > prevLength) {
      if (userIsNearBottomRef.current || prevLength === 0) {
        scrollToBottom();
        const timer = setTimeout(() => scrollToBottom(), 50);
        return () => clearTimeout(timer);
      }
    }
  }, [chatMessages, selectedChatId]);

  useEffect(() => {
    if (!email) return;
    window.localStorage.removeItem(`chatsphere-messages:${email}`);
  }, [email]);

  useEffect(() => {
    if (!isAuthed || !authToken || !email) return;

    let closedByCleanup = false;
    let reconnectTimer: number | undefined;
    const socket = new WebSocket(wsUrl(authToken));
    socketRef.current = socket;

    socket.onopen = () => {
      setDirectoryChats((current) =>
        current.map((chat) => (chat.id === currentUserId ? { ...chat, online: true } : chat))
      );
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          type?: string;
          conversationId?: string;
          userId?: string;
          payload?: ChatMessage & { userId?: string; online?: boolean };
        };
        if (data.type === "presence.updated") {
          const userId = data.payload?.userId || data.userId;
          const online = Boolean(data.payload?.online);
          if (!userId) return;
          setDirectoryChats((current) =>
            current.map((chat) => (chat.id === userId ? { ...chat, online: chat.id === currentUserId ? true : online } : chat))
          );
          return;
        }
        if (data.type !== "chat.message" || !data.payload) return;
        if (!data.payload.id || !data.payload.time) return;
        if (data.payload.senderEmail === email) return;
        if (currentUserId && data.payload.recipientId !== currentUserId) return;

        setChatMessages((current) => {
          const conversationId = data.payload?.senderId || data.conversationId;
          if (!conversationId) return current;
          const incomingMessage: ChatMessage = {
            id: data.payload?.id as string,
            body: data.payload?.body as string,
            time: data.payload?.time as string,
            mine: false,
            senderEmail: data.payload?.senderEmail,
            senderId: data.payload?.senderId,
            recipientId: data.payload?.recipientId,
            attachment: data.payload?.attachment,
            createdAt: data.payload?.createdAt,
            localSeq: getNextLocalSeq()
          };
          const existing = current[conversationId] ?? [];
          return {
            ...current,
            [conversationId]: mergeMessages(existing, [incomingMessage])
          };
        });
      } catch {
        // Ignore malformed realtime events from older clients.
      }
    };

    socket.onerror = () => {
      socket.close();
    };

    socket.onclose = () => {
      if (closedByCleanup) return;
      reconnectTimer = window.setTimeout(() => setSocketAttempt((attempt) => attempt + 1), 2500);
    };

    return () => {
      closedByCleanup = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [authToken, currentUserId, email, isAuthed, socketAttempt]);

  useEffect(() => {
    if (!isAuthed || !authToken) return;

    let cancelled = false;
    const loadUsers = () => {
      setIsDirectoryLoading(true);
      setDirectoryError("");
      fetch(`${apiUrl()}/api/v1/users`, {
        headers: authHeaders(authToken)
      })
        .then((response) => {
          if (!response.ok) throw new Error("Could not load users");
          return response.json();
        })
        .then((data) => {
          if (cancelled) return;
          const users: DirectoryUser[] = Array.isArray(data.users) ? data.users : [];
          setDirectoryChats((current) => {
            if (users.length === 0 && current.length > 0) return current;
            return users.map((user) => {
              const chat = userToChat(user);
              const previous = current.find((currentChat) => currentChat.id === chat.id);
              if (user.email === email) {
                return {
                  ...chat,
                  name: `${chat.name} (You)`,
                  preview: "Saved messages",
                  online: true
                };
              }
              return {
                ...chat,
                online: chat.online || Boolean(previous?.online)
              };
            });
          });
        })
        .catch((error) => {
          if (cancelled) return;
          setDirectoryError(error instanceof Error ? error.message : "Could not load users");
        })
        .finally(() => {
          if (!cancelled) setIsDirectoryLoading(false);
        });
    };

    loadUsers();
    const refresh = window.setInterval(loadUsers, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(refresh);
    };
  }, [authToken, email, isAuthed]);

  useEffect(() => {
    if (!isAuthed || !authToken || !currentUserId) return;

    let cancelled = false;
    setIsInboxLoading(true);
    setInboxError("");
    fetch(`${apiUrl()}/api/v1/messages/inbox`, {
      headers: authHeaders(authToken)
    })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load inbox");
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        const messages: ChatMessage[] = Array.isArray(data.messages) ? data.messages : [];
        const grouped = messages.reduce<MessageStore>((next, message) => {
          const chatId = message.senderEmail === email ? message.recipientId : message.senderId;
          if (!chatId) return next;
          next[chatId] = [...(next[chatId] ?? []), message];
          return next;
        }, {});
        setChatMessages((current) => {
          const next = { ...current };
          Object.entries(grouped).forEach(([chatId, messages]) => {
            next[chatId] = mergeMessages(current[chatId] ?? [], messages);
          });
          return next;
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setInboxError(error instanceof Error ? error.message : "Could not load inbox");
      })
      .finally(() => {
        if (!cancelled) setIsInboxLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, currentUserId, email, isAuthed]);

  useEffect(() => {
    if (!selectedChatId || !authToken) return;
    setChatNotice("");
    fetch(`${apiUrl()}/api/v1/messages/${selectedChatId}/read`, {
      method: "POST",
      headers: authHeaders(authToken)
    }).catch(() => {});
    const readAt = new Date().toISOString();
    setChatMessages((current) => ({
      ...current,
      [selectedChatId]: (current[selectedChatId] ?? []).map((message) => (message.mine ? message : { ...message, readAt }))
    }));
  }, [authToken, selectedChatId]);

  useEffect(() => {
    if (resendSeconds <= 0) return;

    const timer = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsMobileAIChatOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  async function sendCode() {
    if (!email.includes("@")) return;
    setAuthError("");
    setAuthMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`${apiUrl()}/api/v1/auth/email/request-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not send code");
      setAuthMessage("Code sent. Check your inbox, spam, or promotions folder.");
      setAuthStep("code");
      setVerificationCode("");
      setResendSeconds(60);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not send code");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firstName.trim()) {
      setAuthError("First name is required");
      return;
    }
    if (!email.includes("@")) {
      setAuthError("Enter a valid email");
      return;
    }
    if (password.length < 8) {
      setAuthError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setAuthError("Passwords do not match");
      return;
    }
    window.localStorage.setItem(
      "chatsphere-onboarding-draft",
      JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() })
    );
    await sendCode();
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (email.trim().toLowerCase() === adminEmail().toLowerCase()) {
      await loginAdmin();
      return;
    }
    if (!email.includes("@")) {
      setAuthError("Enter a valid email");
      return;
    }
    if (password.length < 8) {
      setAuthError("Enter your password");
      return;
    }

    setAuthError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`${apiUrl()}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Invalid email or password");

      const user = data.user ?? {};
      const token = data.token ?? "";
      setChatMessages({});
      setDrafts({});
      setDirectoryChats([]);
      setSelectedChatId("");
      setSelectedChatSnapshot(null);
      setCurrentUserId(user.id ?? "");
      setAuthToken(token);
      setFirstName(user.firstName ?? "");
      setLastName(user.lastName ?? "");
      setAvatarPreview(user.avatarUrl && !String(user.avatarUrl).startsWith("uploaded:") ? user.avatarUrl : "");
      window.localStorage.setItem("chatsphere-auth", "true");
      window.localStorage.setItem("chatsphere-email", user.email ?? email);
      window.localStorage.setItem("chatsphere-user-id", user.id ?? "");
      window.localStorage.setItem("chatsphere-token", token);
      window.localStorage.setItem("chatsphere-profile-complete", "true");
      window.localStorage.setItem(
        "chatsphere-profile",
        JSON.stringify({
          firstName: user.firstName ?? "",
          lastName: user.lastName ?? "",
          avatarPreview: user.avatarUrl ?? ""
        })
      );
      setIsInboxLoading(true);
      setIsDirectoryLoading(true);
      setInboxError("");
      setDirectoryError("");
      setIsAuthed(true);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not login");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function loginAdmin() {
    setAuthError("");
    setAdminError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`${apiUrl()}/api/v1/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Invalid admin credentials");
      const token = data.token ?? "";
      window.localStorage.setItem("chatsphere-admin-token", token);
      setAdminToken(token);
      setIsAdmin(true);
      await loadAdminUsers(token);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not login as admin");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function loadAdminUsers(token = adminToken) {
    if (!token) return;
    setAdminError("");
    try {
      const response = await fetch(`${apiUrl()}/api/v1/admin/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not load users");
      setAdminUsers(Array.isArray(data.users) ? data.users : []);
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Could not load users");
    }
  }

  async function loadAdminReports(token = adminToken) {
    if (!token) return;
    setAdminError("");
    try {
      const response = await fetch(`${apiUrl()}/api/v1/admin/reports`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not load reports");
      setAdminReports(Array.isArray(data.reports) ? data.reports : []);
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Could not load reports");
    }
  }

  async function updateAdminUser(id: string, action: "block" | "unblock" | "delete") {
    setAdminError("");
    try {
      const response = await fetch(`${apiUrl()}/api/v1/admin/users/${id}${action === "delete" ? "" : `/${action}`}`, {
        method: action === "delete" ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Admin action failed");
      await loadAdminUsers();
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Admin action failed");
    }
  }

  async function resolveAdminReport(id: string) {
    setAdminError("");
    try {
      const response = await fetch(`${apiUrl()}/api/v1/admin/reports/${id}/resolve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not resolve report");
      await loadAdminReports();
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Could not resolve report");
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verificationCode.trim().length < 4) return;
    setAuthError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`${apiUrl()}/api/v1/auth/email/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: verificationCode })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Invalid code");
      window.localStorage.setItem("chatsphere-auth", "true");
      window.localStorage.setItem("chatsphere-email", email);
      window.localStorage.setItem("chatsphere-user-id", data.user?.id ?? "");
      setAuthStep("profile");
      setAuthMessage("");
      setAuthError("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Invalid code");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendPasswordResetCode();
  }

  async function sendPasswordResetCode() {
    if (!email.includes("@")) {
      setAuthError("Enter a valid email");
      return;
    }

    setAuthError("");
    setAuthMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`${apiUrl()}/api/v1/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not send reset code");
      setVerificationCode("");
      setAuthStep("reset-code");
      setAuthMessage("Reset code sent. Check your Gmail inbox, spam, or promotions folder.");
      setResendSeconds(60);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not send reset code");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function verifyPasswordResetCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verificationCode.trim().length < 4) return;

    setAuthError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`${apiUrl()}/api/v1/auth/password-reset/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: verificationCode })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Invalid code");
      setPassword("");
      setConfirmPassword("");
      setAuthMessage("Code verified. Set your new password now.");
      setAuthStep("reset-password");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Invalid code");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function completePasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setAuthError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setAuthError("Passwords do not match");
      return;
    }

    setAuthError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`${apiUrl()}/api/v1/auth/password-reset/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: verificationCode, password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not update password");
      setPassword("");
      setConfirmPassword("");
      setVerificationCode("");
      setAuthStep("login");
      setAuthMessage("Password updated. Login with your new password.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not update password");
    } finally {
      setIsSubmitting(false);
    }
  }

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  function chooseAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file";
    const attachment: AttachmentDraft = {
      name: file.name,
      type: file.type || "application/octet-stream",
      url: URL.createObjectURL(file),
      kind,
      file
    };
    if (selectedChatId) setDraftAttachment(selectedChatId, attachment);
  }

  function setDraftText(chatId: string, text: string) {
    setDrafts((current) => {
      const existing = current[chatId];
      if (!text && !existing?.attachment) {
        const next = { ...current };
        delete next[chatId];
        return next;
      }
      return {
        ...current,
        [chatId]: { text, attachment: existing?.attachment ?? null }
      };
    });
  }

  function setDraftAttachment(chatId: string, attachment: AttachmentDraft | null) {
    setDrafts((current) => {
      const existing = current[chatId];
      if (!attachment && !existing?.text) {
        const next = { ...current };
        delete next[chatId];
        return next;
      }
      return {
        ...current,
        [chatId]: { text: existing?.text ?? "", attachment }
      };
    });
  }

  function removeDraft(chatId: string) {
    setDrafts((current) => {
      if (!(chatId in current)) return current;
      const next = { ...current };
      delete next[chatId];
      return next;
    });
  }

  async function completeProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firstName.trim()) {
      setProfileError("First name is required");
      return;
    }
    if (password.length < 8) {
      setProfileError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setProfileError("Passwords do not match");
      return;
    }

    setIsSubmitting(true);
    setProfileError("");

    try {
      const formData = new FormData();
      formData.set("email", email);
      formData.set("firstName", firstName.trim());
      formData.set("lastName", lastName.trim());
      formData.set("password", password);
      if (avatarFile) formData.set("avatar", avatarFile);

      const response = await fetch(`${apiUrl()}/api/v1/profile/onboarding`, {
        method: "POST",
        body: formData
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not save profile");

      window.localStorage.removeItem("chatsphere-onboarding-draft");
      window.localStorage.setItem("chatsphere-profile-complete", "true");
      const profile = data.profile ?? {};
      const token = data.token ?? "";
      setChatMessages({});
      setDrafts({});
      setDirectoryChats([]);
      setCurrentUserId(profile.id ?? "");
      setAuthToken(token);
      window.localStorage.setItem("chatsphere-user-id", profile.id ?? "");
      window.localStorage.setItem("chatsphere-token", token);
      window.localStorage.setItem(
        "chatsphere-profile",
        JSON.stringify({
          firstName: profile.firstName ?? firstName.trim(),
          lastName: profile.lastName ?? lastName.trim(),
          avatarPreview
        })
      );
      setSelectedChatId("");
      setSelectedChatSnapshot(null);
      setChatSearch("");
      setIsInboxLoading(true);
      setIsDirectoryLoading(true);
      setInboxError("");
      setDirectoryError("");
      setIsAuthed(true);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Could not save profile");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveProfileUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firstName.trim()) {
      setProfileError("First name is required");
      return;
    }

    setIsSubmitting(true);
    setProfileError("");
    setProfileMessage("");

    try {
      const formData = new FormData();
      formData.set("email", email);
      formData.set("firstName", firstName.trim());
      formData.set("lastName", lastName.trim());
      if (avatarFile) formData.set("avatar", avatarFile);

      const response = await fetch(`${apiUrl()}/api/v1/profile`, {
        method: "PATCH",
        headers: authHeaders(authToken),
        body: formData
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not update profile");

      const profile = data.profile ?? {};
      setFirstName(profile.firstName ?? firstName.trim());
      setLastName(profile.lastName ?? lastName.trim());
      setCurrentUserId(profile.id ?? currentUserId);
      const nextAvatar = profile.avatarUrl && !String(profile.avatarUrl).startsWith("uploaded:") ? profile.avatarUrl : avatarPreview;
      setAvatarPreview(nextAvatar);
      setAvatarFile(null);
      window.localStorage.setItem(
        "chatsphere-profile",
        JSON.stringify({
          firstName: profile.firstName ?? firstName.trim(),
          lastName: profile.lastName ?? lastName.trim(),
          avatarPreview: nextAvatar
        })
      );
      window.localStorage.setItem("chatsphere-user-id", profile.id ?? currentUserId);
      setDirectoryChats((current) =>
        current.map((chat) =>
          chat.id === (profile.id ?? currentUserId)
            ? {
                ...chat,
                name: `${`${profile.firstName ?? firstName} ${profile.lastName ?? lastName}`.trim()} (You)`,
                avatar: initials(profile.firstName ?? firstName, profile.lastName ?? lastName),
                avatarUrl: nextAvatar,
                preview: "Saved messages",
                online: true
              }
            : chat
        )
      );
      setProfileMessage("Profile updated.");
      setIsProfileEditorOpen(false);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Could not update profile");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function uploadAttachment(draft: AttachmentDraft) {
    if (!draft.file) return draft;
    const file = await prepareUploadFile(draft.file);
    const formData = new FormData();
    formData.set("file", file);
    const response = await fetch(`${apiUrl()}/api/v1/upload`, {
      method: "POST",
      headers: authHeaders(authToken),
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Could not upload file");
    return {
      name: data.name ?? file.name ?? draft.name,
      type: data.type ?? file.type ?? draft.type,
      kind: data.kind ?? draft.kind,
      url: data.url ?? draft.url
    } as NonNullable<ChatMessage["attachment"]>;
  }

  async function processSendQueue() {
    if (isProcessingQueueRef.current || pendingSendQueueRef.current.length === 0) return;
    isProcessingQueueRef.current = true;

    while (pendingSendQueueRef.current.length > 0) {
      const task = pendingSendQueueRef.current[0];
      const { chatId, message, draftText, draftAttachment } = task;

      let uploadedAttachment: NonNullable<ChatMessage["attachment"]> | undefined;
      let uploadFailed = false;

      if (draftAttachment) {
        try {
          uploadedAttachment = await uploadAttachment(draftAttachment);
        } catch (error) {
          uploadFailed = true;
          setDraftText(chatId, draftText);
          if (draftAttachment) setDraftAttachment(chatId, draftAttachment);
          setAuthError(error instanceof Error ? error.message : "Could not upload file");
          
          setChatMessages((current) => ({
            ...current,
            [chatId]: (current[chatId] ?? []).filter((msg) => msg.id !== message.id)
          }));
        }
      }

      if (uploadFailed) {
        pendingSendQueueRef.current.shift();
        continue;
      }

      if (uploadedAttachment) {
        message.attachment = uploadedAttachment;
        setChatMessages((current) => ({
          ...current,
          [chatId]: (current[chatId] ?? []).map((msg) =>
            msg.id === message.id ? { ...msg, attachment: uploadedAttachment } : msg
          )
        }));
      }

      try {
        const response = await fetch(`${apiUrl()}/api/v1/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders(authToken) },
          body: JSON.stringify({
            recipientId: chatId,
            body: message.body,
            attachment: uploadedAttachment
              ? {
                  name: uploadedAttachment.name,
                  type: uploadedAttachment.type,
                  kind: uploadedAttachment.kind,
                  url: uploadedAttachment.url
                }
              : undefined
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? "Message could not be saved");
        if (data.message?.id) {
          setChatMessages((current) => ({
            ...current,
            [chatId]: (current[chatId] ?? []).map((currentMessage) =>
              currentMessage.id === message.id ? { ...data.message, mine: true, localSeq: currentMessage.localSeq, createdAt: currentMessage.createdAt } : currentMessage
            )
          }));
        }
      } catch (error) {
        setChatMessages((current) => ({
          ...current,
          [chatId]: (current[chatId] ?? []).filter((currentMessage) => currentMessage.id !== message.id)
        }));
        setDraftText(chatId, draftText);
        if (draftAttachment) setDraftAttachment(chatId, draftAttachment);
        setChatNotice(error instanceof Error ? error.message : "Message could not be saved");
      }

      pendingSendQueueRef.current.shift();
    }

    isProcessingQueueRef.current = false;
  }

  async function sendChatMessage() {
    const body = currentMessageDraft.trim();
    if ((!body && !currentAttachmentDraft) || !selectedChatId || !authToken) return;
    if (selectedChatBlocked) {
      setChatNotice("You blocked this user. Unblock them before sending messages.");
      return;
    }
    const chatId = selectedChatId;
    const draftText = currentMessageDraft;
    const draftAttachment = currentAttachmentDraft;
    removeDraft(chatId);
    setIsEmojiOpen(false);

    const message: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      body,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      mine: true,
      senderEmail: email,
      recipientId: chatId,
      attachment: draftAttachment
        ? {
            name: draftAttachment.name,
            type: draftAttachment.type,
            url: draftAttachment.url,
            kind: draftAttachment.kind
          }
        : undefined,
      createdAt: new Date().toISOString(),
      localSeq: getNextLocalSeq()
    };

    setChatMessages((current) => ({
      ...current,
      [chatId]: mergeMessages(current[chatId] ?? [], [message])
    }));

    pendingSendQueueRef.current.push({
      chatId,
      message,
      draftText,
      draftAttachment
    });

    processSendQueue();
  }

  function sendOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    sendChatMessage();
  }

  function addEmoji(emoji: EmojiClickData) {
    if (!selectedChatId) return;
    setDrafts((current) => {
      const existing = current[selectedChatId];
      return {
        ...current,
        [selectedChatId]: { text: `${existing?.text ?? ""}${emoji.emoji}`, attachment: existing?.attachment ?? null }
      };
    });
  }

  function logout() {
    window.localStorage.removeItem("chatsphere-admin-token");
    window.localStorage.removeItem("chatsphere-auth");
    window.localStorage.removeItem("chatsphere-email");
    window.localStorage.removeItem("chatsphere-profile-complete");
    window.localStorage.removeItem("chatsphere-profile");
    window.localStorage.removeItem("chatsphere-user-id");
    window.localStorage.removeItem("chatsphere-token");
    window.localStorage.removeItem("chatsphere-onboarding-draft");
    setIsAuthed(false);
    setIsAdmin(false);
    setAdminToken("");
    setAuthToken("");
    setAdminUsers([]);
    setCurrentUserId("");
    setAuthStep("signup");
    setVerificationCode("");
    setAuthMessage("");
    setAuthError("");
    setResendSeconds(0);
    setFirstName("");
    setLastName("");
    setPassword("");
    setConfirmPassword("");
    setAvatarFile(null);
    setAvatarPreview("");
    setProfileError("");
    setSelectedChatId("");
    setSelectedChatSnapshot(null);
    setChatMessages({});
    setDrafts({});
    setDirectoryChats([]);
    setChatSearch("");
    setIsChatSearchOpen(false);
    setChatMessageSearch("");
    setIsChatMenuOpen(false);
    setIsInboxLoading(false);
    setIsDirectoryLoading(false);
    setInboxError("");
    setDirectoryError("");
  }

  function openWorkspace(mode: WorkspaceMode) {
    setWorkspaceMode(mode);
    setChatSearch("");
    if (mode === "inbox") {
      return;
    }
    if (mode === "search") {
      window.setTimeout(() => chatSearchRef.current?.focus(), 0);
    }
  }

  function selectChat(chat: ChatSeed) {
    setSelectedChatId(chat.id);
    setSelectedChatSnapshot(chat);
    setIsChatMenuOpen(false);
  }

  function toggleChatSearch() {
    setIsChatSearchOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        window.setTimeout(() => chatMessageSearchRef.current?.focus(), 0);
      } else {
        setChatMessageSearch("");
      }
      return nextOpen;
    });
  }

  async function clearCurrentChat() {
    if (!selectedChatId || !authToken || isClearingChat) return;
    const chatId = selectedChatId;
    setChatNotice("");
    setIsClearingChat(true);
    try {
      const response = await fetch(`${apiUrl()}/api/v1/messages/conversation/${chatId}`, {
        method: "DELETE",
        headers: authHeaders(authToken)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not clear conversation");
      setChatMessages((current) => {
        const next = { ...current };
        delete next[chatId];
        return next;
      });
      setIsChatMenuOpen(false);
    } catch (error) {
      setChatNotice(error instanceof Error ? error.message : "Could not clear conversation");
    } finally {
      setIsClearingChat(false);
    }
  }

  async function blockCurrentChat() {
    if (!selectedChatId || !authToken) return;
    setChatNotice("");
    try {
      const response = await fetch(`${apiUrl()}/api/v1/contacts/${selectedChatId}/block`, {
        method: "POST",
        headers: authHeaders(authToken)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not block user");
      setBlockedChatIds((current) => Array.from(new Set([...current, selectedChatId])));
      setChatNotice("User blocked. They cannot message you and you cannot message them.");
      setIsChatMenuOpen(false);
    } catch (error) {
      setChatNotice(error instanceof Error ? error.message : "Could not block user");
    }
  }

  async function unblockCurrentChat() {
    if (!selectedChatId || !authToken) return;
    setChatNotice("");
    try {
      const response = await fetch(`${apiUrl()}/api/v1/contacts/${selectedChatId}/block`, {
        method: "DELETE",
        headers: authHeaders(authToken)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not unblock user");
      setBlockedChatIds((current) => current.filter((id) => id !== selectedChatId));
      setChatNotice("User unblocked.");
      setIsChatMenuOpen(false);
    } catch (error) {
      setChatNotice(error instanceof Error ? error.message : "Could not unblock user");
    }
  }

  async function reportCurrentChat() {
    if (!selectedChatId || !authToken) return;
    const reason = window.prompt("Why are you reporting this user?");
    if (reason === null) return;
    setChatNotice("");
    try {
      const lastIncoming = [...(chatMessages[selectedChatId] ?? [])].reverse().find((message) => !message.mine);
      const response = await fetch(`${apiUrl()}/api/v1/contacts/${selectedChatId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(authToken) },
        body: JSON.stringify({ reason: reason.trim() || "No reason provided", messageId: lastIncoming?.id ?? "" })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not report user");
      setChatNotice("Report sent to admin.");
      setIsChatMenuOpen(false);
    } catch (error) {
      setChatNotice(error instanceof Error ? error.message : "Could not report user");
    }
  }

  function closeCurrentChat() {
    setSelectedChatId("");
    setSelectedChatSnapshot(null);
    setIsChatSearchOpen(false);
    setChatMessageSearch("");
    setIsChatMenuOpen(false);
  }

  if (isAdmin) {
    return (
      <main className="min-h-screen bg-[#eef1f5] text-[#18212f]">
        <section className="mx-auto min-h-screen max-w-6xl px-5 py-8">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#dce1e8] pb-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[#00a884]">Chatsphere Admin</p>
              <h1 className="mt-2 text-3xl font-black tracking-normal">User Control</h1>
            </div>
            <div className="flex gap-2">
              <button className="rounded-xl border border-[#dce1e8] bg-white px-4 py-2 text-sm font-black text-[#334155]" onClick={() => {
                loadAdminUsers();
                loadAdminReports();
              }} type="button">Refresh</button>
              <button className="rounded-xl bg-[#111827] px-4 py-2 text-sm font-black text-white" onClick={logout} type="button">Logout</button>
            </div>
          </header>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-[#dce1e8] bg-white p-5">
              <div className="text-sm font-bold text-[#64748b]">Total users</div>
              <div className="mt-2 text-3xl font-black">{adminUsers.length}</div>
            </div>
            <div className="rounded-2xl border border-[#dce1e8] bg-white p-5">
              <div className="text-sm font-bold text-[#64748b]">Blocked</div>
              <div className="mt-2 text-3xl font-black">{adminUsers.filter((user) => user.blocked).length}</div>
            </div>
            <div className="rounded-2xl border border-[#dce1e8] bg-white p-5">
              <div className="text-sm font-bold text-[#64748b]">Active</div>
              <div className="mt-2 text-3xl font-black">{adminUsers.filter((user) => !user.blocked).length}</div>
            </div>
          </div>

          {adminError ? <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{adminError}</p> : null}

          <div className="mt-6 overflow-hidden rounded-2xl border border-[#dce1e8] bg-white">
            <div className="grid grid-cols-[1fr_120px_260px] border-b border-[#e5e9f0] bg-[#f8fafc] px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-[#64748b]">
              <span>User</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            {adminUsers.length ? (
              adminUsers.map((user) => (
                <div className="grid grid-cols-[1fr_120px_260px] items-center gap-3 border-b border-[#edf1f5] px-4 py-4 last:border-b-0" key={user.id}>
                  <div className="min-w-0">
                    <div className="truncate font-black">{`${user.firstName} ${user.lastName ?? ""}`.trim() || "Unnamed user"}</div>
                    <div className="mt-1 truncate text-sm text-[#64748b]">{user.email}</div>
                  </div>
                  <span className={`w-fit rounded-full px-3 py-1 text-xs font-black ${user.blocked ? "bg-red-50 text-red-700" : "bg-[#e7f8f2] text-[#008f70]"}`}>{user.blocked ? "Blocked" : "Active"}</span>
                  <div className="flex gap-2">
                    <button className="rounded-xl border border-[#dce1e8] px-3 py-2 text-sm font-black text-[#334155]" onClick={() => updateAdminUser(user.id, user.blocked ? "unblock" : "block")} type="button">
                      {user.blocked ? "Unblock" : "Block"}
                    </button>
                    <button className="rounded-xl bg-[#b42318] px-3 py-2 text-sm font-black text-white" onClick={() => updateAdminUser(user.id, "delete")} type="button">Delete</button>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-5 py-12 text-center text-sm font-bold text-[#64748b]">No registered users yet.</div>
            )}
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-[#dce1e8] bg-white">
            <div className="flex items-center justify-between border-b border-[#e5e9f0] bg-[#f8fafc] px-4 py-3">
              <h2 className="text-sm font-black uppercase tracking-[0.12em] text-[#64748b]">Moderation reports</h2>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-[#64748b]">{adminReports.filter((report) => report.status !== "resolved").length} open</span>
            </div>
            {adminReports.length ? (
              adminReports.map((report) => (
                <div className="grid gap-3 border-b border-[#edf1f5] px-4 py-4 last:border-b-0 lg:grid-cols-[1fr_140px]" key={report.id}>
                  <div className="min-w-0">
                    <div className="text-sm font-black text-[#18212f]">
                      {report.reporterName || report.reporterId} reported {report.reportedName || report.reportedId}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-[#64748b]">{report.reason}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-[#94a3b8]">
                      {report.messageId ? <span>Message: {report.messageId}</span> : null}
                      <span>{report.createdAt ? new Date(report.createdAt).toLocaleString() : "Unknown date"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 lg:justify-end">
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${report.status === "resolved" ? "bg-[#e7f8f2] text-[#008f70]" : "bg-amber-50 text-amber-700"}`}>{report.status}</span>
                    {report.status !== "resolved" ? (
                      <button className="rounded-xl border border-[#dce1e8] px-3 py-2 text-sm font-black text-[#334155]" onClick={() => resolveAdminReport(report.id)} type="button">Resolve</button>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="px-5 py-12 text-center text-sm font-bold text-[#64748b]">No reports yet.</div>
            )}
          </div>
        </section>
      </main>
    );
  }

  if (!isAuthed) {
    if (isRestoring) {
      return (
        <main className="grid min-h-screen place-items-center bg-[#07130f] text-white">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="animate-spin text-[#00a884]" size={40} />
            <p className="text-sm font-bold text-[#aebac1]">Restoring your session...</p>
          </div>
        </main>
      );
    }
    return (
      <main className="min-h-screen bg-[#07130f] text-white">
        <section className="mx-auto grid min-h-screen max-w-6xl items-center gap-8 px-5 py-10 lg:grid-cols-[1fr_460px]">
          <div className="cs-fade-up-delay max-w-2xl">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#00a884] text-[#07130f] shadow-[0_18px_50px_rgba(0,168,132,.25)]">
              <MessageCircle size={31} />
            </div>
            <h1 className="mt-8 text-4xl font-bold tracking-normal sm:text-5xl">ChatSphere</h1>
            <p className="mt-4 max-w-xl text-lg leading-8 text-[#c3d0d6]">
              Create an account with email, verify a one-time code, and open your private chats, groups, contacts, and shared media.
            </p>
            <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
              {[
                ["Email account", Mail],
                ["Code secure", ShieldCheck],
                ["Realtime chat", CheckCheck]
              ].map(([label, Icon]) => (
                <div key={label as string} className="rounded-md border border-white/10 bg-white/[0.04] p-4">
                  <Icon className="text-[#00a884]" size={21} />
                  <div className="mt-3 text-sm font-bold">{label as string}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="cs-auth-card rounded-2xl border border-white/10 bg-[#101b17] p-6 shadow-[0_30px_90px_rgba(0,0,0,.38)]">
            {(authStep === "signup" || authStep === "login") ? (
              <div className="mb-5 grid grid-cols-2 rounded-xl border border-white/10 bg-[#07130f] p-1">
                <button
                  className={`h-10 rounded-lg text-sm font-bold ${authStep === "signup" ? "bg-[#00a884] text-[#06130f]" : "text-[#aebac1]"}`}
                  onClick={() => {
                    setAuthStep("signup");
                    setAuthError("");
                  }}
                  type="button"
                >
                  Signup
                </button>
                <button
                  className={`h-10 rounded-lg text-sm font-bold ${authStep === "login" ? "bg-[#00a884] text-[#06130f]" : "text-[#aebac1]"}`}
                  onClick={() => {
                    setAuthStep("login");
                    setAuthError("");
                  }}
                  type="button"
                >
                  Login
                </button>
              </div>
            ) : null}

            <div className="border-b border-white/10 pb-5">
              <h2 className="text-2xl font-bold">
                {authStep === "signup"
                  ? "Create account"
                  : authStep === "login"
                    ? "Login"
                  : authStep === "code"
                    ? "Enter email code"
                  : authStep === "forgot"
                    ? "Forgot password"
                  : authStep === "reset-code"
                    ? "Enter reset code"
                  : authStep === "reset-password"
                    ? "Set new password"
                    : "Profile picture"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#aebac1]">
                {authStep === "signup"
                  ? "Enter your details first. We will send the OTP after signup."
                  : authStep === "login"
                    ? "Already have an account? Use your email and password."
                  : authStep === "code"
                    ? `Enter the 6-digit code sent to ${email}.`
                  : authStep === "forgot"
                    ? "Enter your account email. We will send a reset code to Gmail."
                  : authStep === "reset-code"
                    ? `Enter the password reset code sent to ${email}.`
                  : authStep === "reset-password"
                    ? "Choose a new password for your ChatSphere account."
                    : "Add a profile photo before opening chats."}
              </p>
            </div>
            {authMessage ? <p className="mt-4 rounded-md border border-[#00a884]/30 bg-[#00a884]/10 px-3 py-2 text-sm text-[#bdf5e2]">{authMessage}</p> : null}

            {authStep === "signup" ? (
              <form className="mt-5 space-y-5" onSubmit={requestCode}>
                <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold text-[#d1d7db]">First name</span>
                  <input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#17251f] px-4 text-white outline-none transition placeholder:text-[#6f8188] focus:border-[#00a884] focus:bg-[#1c2d26]"
                    placeholder="Enter first name"
                    type="text"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-[#d1d7db]">
                    Last name <span className="text-[#8696a0]">(optional)</span>
                  </span>
                  <input
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#17251f] px-4 text-white outline-none transition placeholder:text-[#6f8188] focus:border-[#00a884] focus:bg-[#1c2d26]"
                    placeholder="Enter last name"
                    type="text"
                  />
                </label>
                </div>
                <label className="block">
                  <span className="text-sm font-semibold text-[#d1d7db]">Email address</span>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#17251f] px-4 text-white outline-none transition placeholder:text-[#6f8188] focus:border-[#00a884] focus:bg-[#1c2d26]"
                    placeholder="you@example.com"
                    inputMode="email"
                    type="email"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-[#d1d7db]">Set password</span>
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#17251f] px-4 text-white outline-none transition placeholder:text-[#6f8188] focus:border-[#00a884] focus:bg-[#1c2d26]"
                    placeholder="Create password"
                    type="password"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-[#d1d7db]">Confirm password</span>
                  <input
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#17251f] px-4 text-white outline-none transition placeholder:text-[#6f8188] focus:border-[#00a884] focus:bg-[#1c2d26]"
                    placeholder="Repeat password"
                    type="password"
                  />
                </label>
                <button className="cs-press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#00a884] font-bold text-[#06130f] shadow-[0_14px_34px_rgba(0,168,132,.22)] transition hover:bg-[#14c49c]">
                  {isSubmitting ? "Creating account..." : "Signup"}
                  {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                </button>
                <p className="rounded-xl border border-white/10 bg-[#07130f] px-3 py-2 text-xs leading-5 text-[#8696a0]">After signup, we will send a 6-digit code to your Gmail.</p>
                {authError ? <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-200">{authError}</p> : null}
              </form>
            ) : authStep === "login" ? (
              <form className="mt-5 space-y-5" onSubmit={login}>
                <label className="block">
                  <span className="text-sm font-semibold text-[#d1d7db]">Email address</span>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#17251f] px-4 text-white outline-none transition placeholder:text-[#6f8188] focus:border-[#00a884] focus:bg-[#1c2d26]"
                    placeholder="you@example.com"
                    inputMode="email"
                    type="email"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-[#d1d7db]">Password</span>
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#17251f] px-4 text-white outline-none transition placeholder:text-[#6f8188] focus:border-[#00a884] focus:bg-[#1c2d26]"
                    placeholder="Enter password"
                    type="password"
                  />
                </label>
                <button disabled={isSubmitting} className="cs-press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#00a884] font-bold text-[#06130f] shadow-[0_14px_34px_rgba(0,168,132,.22)] transition hover:bg-[#14c49c]">
                  {isSubmitting ? "Logging in..." : "Login"}
                  {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <ShieldCheck size={18} />}
                </button>
                <button
                  className="w-full text-center text-sm font-bold text-[#00a884] hover:text-[#46dfbd]"
                  onClick={() => {
                    setAuthStep("forgot");
                    setAuthError("");
                    setAuthMessage("");
                    setVerificationCode("");
                    setPassword("");
                    setConfirmPassword("");
                  }}
                  type="button"
                >
                  Forgot password?
                </button>
                {authError ? <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-200">{authError}</p> : null}
              </form>
            ) : authStep === "forgot" ? (
              <form className="mt-5 space-y-5" onSubmit={requestPasswordReset}>
                <label className="block">
                  <span className="text-sm font-semibold text-[#d1d7db]">Email address</span>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#17251f] px-4 text-white outline-none transition placeholder:text-[#6f8188] focus:border-[#00a884] focus:bg-[#1c2d26]"
                    placeholder="you@example.com"
                    inputMode="email"
                    type="email"
                  />
                </label>
                <button className="cs-press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#00a884] font-bold text-[#06130f] shadow-[0_14px_34px_rgba(0,168,132,.22)] transition hover:bg-[#14c49c]">
                  {isSubmitting ? "Sending code..." : "Send reset code"}
                  {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Mail size={18} />}
                </button>
                <button className="w-full text-center text-sm font-bold text-[#aebac1] hover:text-white" onClick={() => setAuthStep("login")} type="button">
                  Back to login
                </button>
                {authError ? <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-200">{authError}</p> : null}
              </form>
            ) : authStep === "reset-code" ? (
              <form className="mt-5 space-y-5" onSubmit={verifyPasswordResetCode}>
                <label className="block">
                  <span className="text-sm font-semibold text-[#d1d7db]">Reset code</span>
                  <input
                    value={verificationCode}
                    onChange={(event) => setVerificationCode(event.target.value)}
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#17251f] px-4 text-center text-xl font-black tracking-[.35em] text-white outline-none transition placeholder:text-[#6f8188] focus:border-[#00a884] focus:bg-[#1c2d26]"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                  />
                </label>
                <button className="cs-press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#00a884] font-bold text-[#06130f] shadow-[0_14px_34px_rgba(0,168,132,.22)] transition hover:bg-[#14c49c]">
                  Verify code
                  <ShieldCheck size={18} />
                </button>
                <button
                  className="w-full text-center text-sm font-bold text-[#00a884] disabled:cursor-not-allowed disabled:text-[#6f8188]"
                  disabled={resendSeconds > 0 || isSubmitting}
                  onClick={sendPasswordResetCode}
                  type="button"
                >
                  {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
                </button>
                {authError ? <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-200">{authError}</p> : null}
              </form>
            ) : authStep === "reset-password" ? (
              <form className="mt-5 space-y-5" onSubmit={completePasswordReset}>
                <label className="block">
                  <span className="text-sm font-semibold text-[#d1d7db]">New password</span>
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#17251f] px-4 text-white outline-none transition placeholder:text-[#6f8188] focus:border-[#00a884] focus:bg-[#1c2d26]"
                    placeholder="Enter new password"
                    type="password"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-[#d1d7db]">Confirm new password</span>
                  <input
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#17251f] px-4 text-white outline-none transition placeholder:text-[#6f8188] focus:border-[#00a884] focus:bg-[#1c2d26]"
                    placeholder="Repeat new password"
                    type="password"
                  />
                </label>
                <button className="cs-press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#00a884] font-bold text-[#06130f] shadow-[0_14px_34px_rgba(0,168,132,.22)] transition hover:bg-[#14c49c]">
                  Update password
                  <ShieldCheck size={18} />
                </button>
                {authError ? <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-200">{authError}</p> : null}
              </form>
            ) : authStep === "profile" ? (
              <form className="mt-5 space-y-4" onSubmit={completeProfile}>
                <div className="rounded-md border border-white/10 bg-[#0b141a] p-4">
                  <div className="text-sm font-bold text-[#00a884]">Account details</div>
                  <div className="mt-3 space-y-2 text-sm text-[#d1d7db]">
                    <div>
                      <span className="text-[#8696a0]">Email:</span> {email}
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-semibold text-[#d1d7db]">First name</span>
                    <input
                      value={firstName}
                      onChange={(event) => setFirstName(event.target.value)}
                      className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#17251f] px-4 text-white outline-none transition placeholder:text-[#6f8188] focus:border-[#00a884] focus:bg-[#1c2d26]"
                      placeholder="Enter first name"
                      type="text"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-[#d1d7db]">
                      Last name <span className="text-[#8696a0]">(optional)</span>
                    </span>
                    <input
                      value={lastName}
                      onChange={(event) => setLastName(event.target.value)}
                      className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#17251f] px-4 text-white outline-none transition placeholder:text-[#6f8188] focus:border-[#00a884] focus:bg-[#1c2d26]"
                      placeholder="Enter last name"
                      type="text"
                    />
                  </label>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-semibold text-[#d1d7db]">Set password</span>
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#17251f] px-4 text-white outline-none transition placeholder:text-[#6f8188] focus:border-[#00a884] focus:bg-[#1c2d26]"
                      placeholder="Create password"
                      type="password"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-[#d1d7db]">Confirm password</span>
                    <input
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#17251f] px-4 text-white outline-none transition placeholder:text-[#6f8188] focus:border-[#00a884] focus:bg-[#1c2d26]"
                      placeholder="Repeat password"
                      type="password"
                    />
                  </label>
                </div>
                <div className="flex items-center gap-4 rounded-md border border-white/10 bg-[#0b141a] p-4">
                  <label className="grid h-20 w-20 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full border border-white/10 bg-[#202c33] text-[#00a884]">
                    {avatarPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="Profile preview" className="h-full w-full object-cover" src={avatarPreview} />
                    ) : (
                      <Upload size={28} />
                    )}
                    <input accept="image/*" className="hidden" onChange={chooseAvatar} type="file" />
                  </label>
                  <div className="min-w-0">
                    <div className="font-bold text-white">Profile picture</div>
                    <div className="mt-1 text-sm leading-5 text-[#aebac1]">Upload a photo so contacts can recognize you.</div>
                  </div>
                </div>
                <button className="cs-press flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#00a884] font-bold text-[#06130f]">
                  {isSubmitting ? "Saving profile..." : "Continue to chats"}
                  {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <ShieldCheck size={18} />}
                </button>
                <button
                  className="flex w-full items-center justify-center gap-1 text-center text-sm font-bold text-[#aebac1] hover:text-white disabled:cursor-not-allowed disabled:text-[#6f8188]"
                  disabled={isSubmitting}
                  onClick={() => {
                    window.localStorage.removeItem("chatsphere-auth");
                    setAuthStep("signup");
                    setAuthError("");
                    setProfileError("");
                  }}
                  type="button"
                >
                  <ArrowLeft size={14} />
                  Back to signup
                </button>
                {profileError ? <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-200">{profileError}</p> : null}
              </form>
            ) : (
              <form className="mt-5 space-y-4" onSubmit={verifyCode}>
                <label className="block">
                  <span className="text-sm font-semibold text-[#d1d7db]">Verification code</span>
                  <input
                    value={verificationCode}
                    onChange={(event) => setVerificationCode(event.target.value)}
                    className="mt-2 h-14 w-full rounded-md border border-white/10 bg-[#202c33] px-4 text-center text-2xl font-bold tracking-[0.35em] text-white outline-none placeholder:text-[#8696a0]"
                    placeholder="123456"
                    maxLength={6}
                    inputMode="numeric"
                  />
                </label>
                <div className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-white/10 bg-[#0b141a] px-3 py-2 text-sm text-[#aebac1]">
                  <span>{resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : "Did not get the code?"}</span>
                  <button
                    className="rounded-md px-3 py-2 font-bold text-[#00a884] disabled:cursor-not-allowed disabled:text-[#64757d]"
                    disabled={resendSeconds > 0 || isSubmitting}
                    onClick={sendCode}
                    type="button"
                  >
                    Resend
                  </button>
                </div>
                <button className="cs-press flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#00a884] font-bold text-[#06130f]">
                  {isSubmitting ? "Checking code..." : "Verify and continue"}
                  {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <ShieldCheck size={18} />}
                </button>
                {authError ? <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-200">{authError}</p> : null}
              </form>
            )}
            <div className="mt-6 flex justify-center gap-4 border-t border-white/10 pt-4 text-xs font-bold text-[#8696a0]">
              <a className="hover:text-white" href="/privacy">Privacy</a>
              <a className="hover:text-white" href="/terms">Terms</a>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-[#eef1f5] text-[#18212f]">
      <section
        className={`grid h-screen min-h-0 ${
          workspaceMode === "ai"
            ? "lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,1fr)]"
            : "lg:grid-cols-[250px_350px_minmax(0,1fr)] xl:grid-cols-[270px_390px_minmax(0,1fr)]"
        }`}
      >
        <aside className="hidden h-screen flex-col border-r border-white/5 bg-[#0b1120] px-4 py-6 text-white lg:flex">
          <div className="flex items-center gap-3 px-2">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#3b82f6] text-white shadow-[0_6px_18px_rgba(124,58,237,.4)]">
              <MessageCircle size={20} />
            </span>
            <span className="text-lg font-black tracking-tight">ChatSphere</span>
          </div>
          <nav className="mt-8 space-y-1.5">
            {[
              { label: "Chats", mode: "inbox" as const, icon: MessageCircle },
              { label: "Search", mode: "search" as const, icon: Search },
              { label: "Users", mode: "contacts" as const, icon: Users },
              { label: "Documents", mode: "files" as const, icon: FileText },
              { label: "AI Assistant", mode: "ai" as const, icon: Bot }
            ].map(({ icon: Icon, label, mode }) => {
              const isActive = workspaceMode === mode;
              return (
                <button
                  aria-label={label}
                  className={`cs-press flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    isActive && mode === "ai"
                      ? "bg-gradient-to-r from-[#7c3aed] to-[#3b82f6] text-white shadow-[0_8px_24px_rgba(124,58,237,.4)]"
                      : isActive
                        ? "bg-white/10 text-white"
                        : "text-[#94a3b8] hover:bg-white/5 hover:text-white"
                  }`}
                  key={mode}
                  onClick={() => openWorkspace(mode)}
                  type="button"
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
          <button
            aria-label="Logout"
            className="cs-press mt-auto flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#94a3b8] transition hover:bg-white/5 hover:text-white"
            onClick={logout}
            type="button"
          >
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </aside>

        {workspaceMode !== "ai" ? (
        <aside className={`h-screen min-h-0 overflow-y-auto border-r border-[#dce1e8] bg-white ${selectedChat ? "hidden lg:block" : "block"}`}>
          <header className="border-b border-[#e5e9f0] px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[#00a884]">Chatsphere</p>
                <h1 className="mt-2 text-2xl font-black tracking-normal">{workspaceTitle}</h1>
              </div>
              <button className="grid h-11 w-11 place-items-center overflow-hidden rounded-xl bg-[#e7f8f2] text-sm font-black text-[#008f70]" onClick={() => {
                setIsProfileEditorOpen(true);
                setProfileError("");
                setProfileMessage("");
              }} title="Edit your profile" type="button">
                {avatarPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="Your profile" className="h-full w-full object-cover" src={avatarPreview} />
                ) : (
                  userInitials
                )}
              </button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {[
                ["Me", "0"],
                ["Open", String(inboxChats.length)],
                ["All", String(directoryChats.length)]
              ].map(([label, count], index) => (
                <button key={label} className={`rounded-xl border px-3 py-2 text-left ${index === 1 ? "border-[#00a884] bg-[#e7f8f2]" : "border-[#e5e9f0] bg-[#f7f9fb]"}`} type="button">
                  <div className="text-xs font-bold text-[#64748b]">{label}</div>
                  {isInboxLoading || isDirectoryLoading ? (
                    <div className="cs-skeleton mt-1.5 h-5 w-8" />
                  ) : (
                    <div className="mt-1 text-lg font-black">{count}</div>
                  )}
                </button>
              ))}
            </div>
            <label className="mt-5 flex h-11 items-center gap-3 rounded-xl border border-[#dce1e8] bg-[#f7f9fb] px-3 text-[#64748b]">
              <Search size={19} />
              <input
                ref={chatSearchRef}
                className="w-full bg-transparent text-sm outline-none focus-visible:!outline-none placeholder:text-[#94a3b8]"
                onChange={(event) => setChatSearch(event.target.value)}
                placeholder="Search by name"
                value={chatSearch}
              />
            </label>
          </header>

          <div className="px-3 py-4">
            <div className="mb-3 flex items-center justify-between px-2">
              <h2 className="text-sm font-black">
                {workspaceMode === "files" ? "Shared files" : workspaceMode === "contacts" ? "All contacts" : "Open conversations"}
              </h2>
              <span className="text-xs font-bold text-[#94a3b8]">{workspaceMode === "files" ? attachedMessages.length : workspaceMode === "contacts" ? contactResults.length : "Date"}</span>
            </div>
            {workspaceMode === "files" ? (
              <div className="space-y-2">
                {attachedMessages.length ? (
                  attachedMessages.map(({ chat, message }) => (
                    <button
                      className="cs-hover-lift flex w-full items-start gap-3 rounded-2xl border border-transparent bg-white p-3 text-left transition hover:border-[#e5e9f0] hover:bg-[#f8fafc]"
                      key={message.id}
                      onClick={() => chat && selectChat(chat)}
                      type="button"
                    >
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#e7f8f2] text-[#008f70]">
                        <FileText size={20} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-sm">{message.attachment?.name}</strong>
                        <span className="mt-1 block truncate text-sm text-[#64748b]">{chat?.name ?? "Unknown chat"} - {message.time}</span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-5 py-10 text-center">
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#e7f8f2] text-[#00a884]">
                      <FileText size={24} />
                    </div>
                    <h2 className="mt-5 text-base font-black">No files yet</h2>
                    <p className="mt-2 text-sm leading-6 text-[#64748b]">Images, videos, and documents you send will show here.</p>
                  </div>
                )}
              </div>
            ) : workspaceMode === "contacts" ? (
              <div className="space-y-2">
                {contactResults.length ? (
                  contactResults.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => selectChat(chat)}
                      className={`cs-hover-lift flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition ${
                        selectedChatId === chat.id ? "border-[#00a884] bg-[#effdf8] shadow-sm" : "border-transparent bg-white hover:border-[#e5e9f0] hover:bg-[#f8fafc]"
                      }`}
                      type="button"
                    >
                      <ChatAvatar chat={chat} className="h-11 w-11 rounded-xl text-sm" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <strong className="truncate text-sm">{chat.name}</strong>
                          <span className="text-xs font-bold text-[#00a884]">{chat.online ? "online" : "offline"}</span>
                        </span>
                        <span className="mt-1 block truncate text-sm text-[#64748b]">{chat.online ? "Online now" : "Offline"}</span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-8 text-center text-sm text-[#64748b]">No contact found. Try another name or email.</div>
                )}
              </div>
            ) : chatSearch.trim() ? (
              <div className="space-y-2">
                {searchResults.length ? (
                  searchResults.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => selectChat(chat)}
                      className={`cs-hover-lift flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition ${
                        selectedChatId === chat.id ? "border-[#00a884] bg-[#effdf8] shadow-sm" : "border-transparent bg-white hover:border-[#e5e9f0] hover:bg-[#f8fafc]"
                      }`}
                    >
                      <ChatAvatar chat={chat} className="h-11 w-11 rounded-xl text-sm" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <strong className="truncate text-sm">{chat.name}</strong>
                          <span className="text-xs font-bold text-[#94a3b8]">{chatMessages[chat.id]?.at(-1)?.time ?? "new"}</span>
                        </span>
                        <span className="mt-1 block truncate text-sm text-[#64748b]">{chat.online ? "Online now" : "Offline"}</span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-8 text-center text-sm text-[#64748b]">No registered user found.</div>
                )}
              </div>
            ) : workspaceMode === "inbox" ? (
              <div className="space-y-2">
                {isInboxLoading ? (
                  <>
                    {[0, 1, 2].map((item) => (
                      <div key={item} className="flex w-full items-start gap-3 rounded-2xl border border-transparent bg-white p-3">
                        <div className="cs-skeleton h-11 w-11 shrink-0 rounded-xl" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="cs-skeleton h-4 w-24" />
                            <div className="cs-skeleton h-3 w-10" />
                          </div>
                          <div className="cs-skeleton mt-2 h-3 w-40" />
                        </div>
                      </div>
                    ))}
                  </>
                ) : inboxError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-8 text-center">
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-100 text-red-600">
                      <MessageCircle size={24} />
                    </div>
                    <h2 className="mt-5 text-base font-black text-red-700">Could not load inbox</h2>
                    <p className="mt-2 text-sm leading-6 text-red-600">{inboxError}</p>
                  </div>
                ) : inboxChats.length ? (
                  inboxChats.map((chat) => {
                    const lastMessage = chatMessages[chat.id]?.at(-1);
                    const unread = unreadByChat[chat.id] ?? 0;
                    return (
                      <button
                        key={chat.id}
                        onClick={() => selectChat(chat)}
                        className={`cs-hover-lift flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition ${
                          selectedChatId === chat.id ? "border-[#00a884] bg-[#effdf8] shadow-sm" : "border-transparent bg-white hover:border-[#e5e9f0] hover:bg-[#f8fafc]"
                        }`}
                        type="button"
                      >
                        <ChatAvatar chat={chat} className="h-11 w-11 rounded-xl text-sm" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <strong className="truncate text-sm">{chat.name}</strong>
                            <span className="text-xs font-bold text-[#94a3b8]">{lastMessage?.time}</span>
                          </span>
                          <span className="mt-1 flex items-center justify-between gap-2 text-sm text-[#64748b]">
                            <span className="truncate">{lastMessage?.body || lastMessage?.attachment?.name || "Attachment"}</span>
                            {unread ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#00a884] px-1.5 text-[11px] font-black text-white">{unread}</span> : null}
                          </span>
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-5 py-10 text-center">
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#e7f8f2] text-[#00a884]">
                      <MessageCircle size={24} />
                    </div>
                    <h2 className="mt-5 text-base font-black">Inbox is empty</h2>
                    <p className="mt-2 text-sm leading-6 text-[#64748b]">People appear here after you send or receive a message.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-5 py-10 text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#e7f8f2] text-[#00a884]">
                  <Search size={24} />
                </div>
                <h2 className="mt-5 text-base font-black">Find someone to message</h2>
                <p className="mt-2 text-sm leading-6 text-[#64748b]">Registered users will appear here after database search is connected.</p>
              </div>
            )}
          </div>
        </aside>
        ) : null}

        <section className={`h-screen min-h-0 flex-col overflow-hidden bg-[#f7f9fb] ${selectedChat ? "flex" : "hidden lg:flex"} ${workspaceMode === "ai" ? "hidden lg:flex" : ""}`}>
          {workspaceMode === "ai" ? (
            <AIChat apiUrl={apiUrl()} authToken={authToken} />
          ) : selectedChat ? (
            <>
              <header className="flex min-h-[82px] items-center justify-between gap-3 border-b border-[#e5e9f0] bg-white px-4 sm:px-6">
                <div className={`min-w-0 items-center gap-3 sm:gap-4 ${isChatSearchOpen ? "hidden sm:flex" : "flex"}`}>
                  <button aria-label="Back to chats" className="cs-press grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#64748b] hover:bg-[#f1f5f9] lg:hidden" onClick={closeCurrentChat} type="button">
                    <ArrowLeft size={22} />
                  </button>
                  <ChatAvatar chat={selectedChat} className="h-12 w-12 rounded-2xl text-base" />
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-black">{selectedChat.name}</h2>
                    <p className={`text-sm font-semibold ${selectedChat.online ? "text-[#00a884]" : "text-[#94a3b8]"}`}>{selectedChat.online ? "Online" : "Offline"}</p>
                  </div>
                </div>
                <div className={`relative flex min-w-0 items-center justify-end gap-2 text-[#64748b] sm:gap-4 ${isChatSearchOpen ? "flex-1" : ""}`}>
                  {isChatSearchOpen ? (
                    <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#dce1e8] bg-[#f8fafc] px-3 sm:w-72 sm:flex-none">
                      <Search size={18} />
                      <input
                        ref={chatMessageSearchRef}
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#94a3b8]"
                        onChange={(event) => setChatMessageSearch(event.target.value)}
                        placeholder="Search this chat"
                        value={chatMessageSearch}
                      />
                    </label>
                  ) : null}
                  <button aria-label="Search this chat" className="cs-press grid h-10 w-10 place-items-center rounded-xl hover:bg-[#f1f5f9]" onClick={toggleChatSearch} type="button">
                    <Search size={23} />
                  </button>
                  <button aria-label="Chat options" className="cs-press grid h-10 w-10 place-items-center rounded-xl hover:bg-[#f1f5f9]" onClick={() => setIsChatMenuOpen((open) => !open)} type="button">
                    <MoreVertical size={23} />
                  </button>
                  {isChatMenuOpen ? (
                    <div className="cs-scale-in absolute right-0 top-12 z-30 w-56 overflow-hidden rounded-2xl border border-[#dce1e8] bg-white py-2 text-sm font-bold text-[#334155] shadow-[0_18px_45px_rgba(15,23,42,.14)]">
                      <div className="border-b border-[#edf1f5] px-4 py-3">
                        <div className="truncate text-[#18212f]">{selectedChat.name}</div>
                        <div className={`mt-1 text-xs ${selectedChat.online ? "text-[#00a884]" : "text-[#94a3b8]"}`}>{selectedChat.online ? "Online" : "Offline"}</div>
                      </div>
                      <button className="flex w-full items-center px-4 py-3 text-left hover:bg-[#f8fafc]" onClick={toggleChatSearch} type="button">Search messages</button>
                      <button className="flex w-full items-center px-4 py-3 text-left hover:bg-[#f8fafc]" onClick={reportCurrentChat} type="button">Report user</button>
                      {selectedChatBlocked ? (
                        <button className="flex w-full items-center px-4 py-3 text-left hover:bg-[#f8fafc]" onClick={unblockCurrentChat} type="button">Unblock user</button>
                      ) : (
                        <button className="flex w-full items-center px-4 py-3 text-left text-[#b42318] hover:bg-[#fff5f5]" onClick={blockCurrentChat} type="button">Block user</button>
                      )}
                      <button className={`flex w-full items-center px-4 py-3 text-left text-[#b42318] ${isClearingChat ? "opacity-50 cursor-not-allowed" : "hover:bg-[#fff5f5]"}`} onClick={clearCurrentChat} disabled={isClearingChat} type="button">
                        {isClearingChat ? "Chat clearing..." : "Clear chat"}
                      </button>
                      <button className="flex w-full items-center px-4 py-3 text-left hover:bg-[#f8fafc]" onClick={closeCurrentChat} type="button">Close chat</button>
                    </div>
                  ) : null}
                </div>
              </header>

              <div ref={scrollContainerRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 pb-28 sm:px-6 sm:py-8 sm:pb-32">
                <div className="mx-auto mb-8 w-fit rounded-full border border-[#dce1e8] bg-white px-4 py-2 text-xs font-bold text-[#64748b]">Conversation started</div>
                {visibleSelectedMessages.length ? (
                  <div className="space-y-4">
                    {visibleSelectedMessages.map((message) => (
                      <div key={message.id} className={`cs-message-in flex ${message.mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[72%] rounded-2xl border px-4 py-3 shadow-sm ${message.mine ? "border-[#00a884]/20 bg-[#dff8ef]" : "border-[#e5e9f0] bg-white"}`}>
                          {message.attachment ? <AttachmentPreview attachment={message.attachment} authToken={authToken} /> : null}
                          {message.body ? <p className="text-sm leading-6 text-[#18212f]">{message.body}</p> : null}
                          <div className="mt-2 flex justify-end gap-1 text-xs font-semibold text-[#94a3b8]">
                            {message.time}
                            {message.mine ? (
                              <>
                                <span>{message.readAt ? "Seen" : "Sent"}</span>
                                <CheckCheck size={15} className={message.readAt ? "text-[#00a884]" : "text-[#94a3b8]"} />
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mx-auto mt-20 max-w-md rounded-3xl border border-dashed border-[#cbd5e1] bg-white px-8 py-10 text-center text-sm leading-6 text-[#64748b]">
                    <MessageCircle className="mx-auto text-[#00a884]" size={34} />
                    <h3 className="mt-4 text-lg font-black text-[#18212f]">{chatMessageSearch.trim() ? "No matching messages" : "No messages yet"}</h3>
                    <p className="mt-2">{chatMessageSearch.trim() ? "Try a different word from this conversation." : "Write the first message below. Attachments and emojis are ready."}</p>
                  </div>
                )}
              </div>

              <footer className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#e5e9f0] bg-white px-3 py-3 shadow-[0_-14px_35px_rgba(15,23,42,.08)] sm:px-5 lg:left-[600px] xl:left-[660px]">
                {chatNotice ? <div className="mb-3 rounded-xl border border-[#dce1e8] bg-[#f8fafc] px-3 py-2 text-sm font-semibold text-[#64748b]">{chatNotice}</div> : null}
                {isEmojiOpen ? (
                  <div className="cs-scale-in absolute bottom-[78px] left-3 z-20 overflow-hidden rounded-2xl border border-[#dce1e8] bg-white shadow-2xl sm:left-5">
                    <EmojiPicker height={390} onEmojiClick={addEmoji} previewConfig={{ showPreview: false }} searchDisabled={false} skinTonesDisabled theme={Theme.LIGHT} width={340} />
                  </div>
                ) : null}
                {currentAttachmentDraft ? (
                  <div className="mb-3 flex items-center justify-between rounded-xl border border-[#dce1e8] bg-[#f8fafc] px-3 py-2 text-sm text-[#334155]">
                    <div className="min-w-0 truncate">
                      <span className="font-black text-[#00a884]">{currentAttachmentDraft.kind.toUpperCase()}</span> {currentAttachmentDraft.name}
                    </div>
                    <button className="ml-3 text-[#64748b] hover:text-[#18212f]" onClick={() => { if (selectedChatId) setDraftAttachment(selectedChatId, null); }} type="button">Remove</button>
                  </div>
                ) : null}
                <div className="flex w-full items-center gap-2 rounded-2xl border border-[#dce1e8] bg-[#f8fafc] p-2 shadow-sm focus-within:border-[#00a884] focus-within:bg-white sm:gap-3">
                  <button aria-label="Emoji" className={`cs-press grid h-10 w-10 shrink-0 place-items-center rounded-xl ${isEmojiOpen ? "bg-[#e7f8f2] text-[#00a884]" : "text-[#64748b] hover:bg-white hover:text-[#18212f]"}`} onClick={() => setIsEmojiOpen((open) => !open)} type="button">
                    <Smile size={22} />
                  </button>
                  <label aria-label="Attach file" className="cs-press grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl text-[#64748b] hover:bg-white hover:text-[#18212f]">
                    <Paperclip size={22} />
                    <input accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.apk" className="hidden" onChange={chooseAttachment} type="file" />
                  </label>
                  <input
                    className="h-11 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm outline-none placeholder:text-[#94a3b8] sm:px-2"
                    onChange={(event) => { if (selectedChatId) setDraftText(selectedChatId, event.target.value); }}
                    onKeyDown={sendOnEnter}
                    placeholder={selectedChatBlocked ? "Unblock this user to send messages" : "Write a message"}
                    value={currentMessageDraft}
                    disabled={selectedChatBlocked}
                  />
                  <button aria-label="Send" className="cs-press flex h-11 shrink-0 items-center gap-2 rounded-xl bg-[#00a884] px-4 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 sm:px-5" disabled={selectedChatBlocked || (!currentMessageDraft.trim() && !currentAttachmentDraft)} onClick={sendChatMessage}>
                    <span className="hidden sm:inline">Send</span>
                    <Send size={18} />
                  </button>
                </div>
              </footer>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6">
            <div className="cs-fade-up max-w-lg text-center">
                <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl border border-[#dce1e8] bg-white text-[#00a884] shadow-sm">
                  <MessageCircle size={36} />
                </div>
                <h2 className="mt-6 text-3xl font-black tracking-normal">No conversation selected</h2>
                <p className="mt-3 text-base leading-7 text-[#64748b]">Search a user from the inbox queue. The active conversation will appear here.</p>
              </div>
            </div>
          )}
        </section>

      </section>

      {/* Floating AI button - mobile & tablet only */}
      {!isMobileAIChatOpen ? (
        <button
          aria-label="Open AI Assistant"
          className="cs-press fixed bottom-24 right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#7c3aed] to-[#3b82f6] text-white shadow-[0_12px_32px_rgba(124,58,237,.45)] transition hover:scale-105 hover:shadow-[0_16px_40px_rgba(124,58,237,.55)] lg:hidden sm:bottom-28 sm:right-6"
          onClick={() => setIsMobileAIChatOpen(true)}
          type="button"
        >
          <Bot size={26} />
        </button>
      ) : null}

      {/* Mobile & tablet AI chat overlay */}
      {isMobileAIChatOpen ? (
        <div className="cs-scale-in fixed inset-0 z-[60] flex flex-col bg-[#f7f9fb] lg:hidden">
          <AIChat apiUrl={apiUrl()} authToken={authToken} onClose={() => setIsMobileAIChatOpen(false)} />
        </div>
      ) : null}

      {isProfileEditorOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#0f172a]/45 px-4">
          <form className="cs-scale-in max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-[#dce1e8] bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,.22)]" onSubmit={saveProfileUpdate}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[#00a884]">Profile</p>
                <h2 className="mt-2 text-2xl font-black">Edit your profile</h2>
              </div>
              <button className="rounded-xl border border-[#dce1e8] px-3 py-2 text-sm font-black text-[#64748b]" onClick={() => setIsProfileEditorOpen(false)} type="button">
                Close
              </button>
            </div>

            <div className="mt-6 flex items-center gap-4 rounded-2xl border border-[#e5e9f0] bg-[#f8fafc] p-4">
              <label className="grid h-20 w-20 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-2xl bg-[#e7f8f2] text-xl font-black text-[#008f70]">
                {avatarPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="Profile preview" className="h-full w-full object-cover" src={avatarPreview} />
                ) : (
                  userInitials
                )}
                <input accept="image/*" className="hidden" onChange={chooseAvatar} type="file" />
              </label>
              <div className="min-w-0">
                <div className="text-sm font-black text-[#18212f]">Profile photo</div>
                <p className="mt-1 text-sm leading-6 text-[#64748b]">Click the photo box to choose a new image.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-bold text-[#334155]">First name</span>
                <input className="mt-2 h-11 w-full rounded-xl border border-[#dce1e8] bg-white px-3 text-sm outline-none focus:border-[#00a884]" onChange={(event) => setFirstName(event.target.value)} value={firstName} />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-[#334155]">Last name</span>
                <input className="mt-2 h-11 w-full rounded-xl border border-[#dce1e8] bg-white px-3 text-sm outline-none focus:border-[#00a884]" onChange={(event) => setLastName(event.target.value)} value={lastName} />
              </label>
            </div>

            {profileError ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{profileError}</p> : null}
            {profileMessage ? <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{profileMessage}</p> : null}
            <button className="cs-press mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#00a884] text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Saving..." : "Save profile"}
              {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}
            </button>
            <button
              aria-label="Log out"
              className="cs-press mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 text-sm font-black text-[#b42318] transition hover:bg-red-100"
              onClick={logout}
              type="button"
            >
              <LogOut size={18} />
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function apiUrl() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined" && window.location.hostname === "localhost") return "http://localhost:8080";
  return "https://chatsphere-production-a4fd.up.railway.app";
}

function adminEmail() {
  return process.env.NEXT_PUBLIC_ADMIN_EMAIL || "ChatSphere@gmail.com";
}

function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function wsUrl(token: string) {
  const base = apiUrl();
  return `${base.replace(/^http/, "ws").replace(/\/$/, "")}/ws?token=${encodeURIComponent(token)}`;
}

let localSeqCounter = 0;
function getNextLocalSeq() {
  localSeqCounter++;
  return localSeqCounter;
}

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map<string, ChatMessage>();
  
  existing.forEach((msg) => {
    if (msg.id) byId.set(msg.id, msg);
  });

  incoming.forEach((incMsg) => {
    if (!incMsg.id) return;

    let matchedOptimisticId: string | null = null;
    byId.forEach((extMsg, id) => {
      if (matchedOptimisticId) return;
      if (id.includes("-") && extMsg.mine && !incMsg.id.includes("-")) {
        const sameBody = extMsg.body === incMsg.body;
        const sameRecipient = extMsg.recipientId === incMsg.recipientId;
        const extTime = Date.parse(extMsg.createdAt ?? "");
        const incTime = Date.parse(incMsg.createdAt ?? "");
        const closeTime = Number.isFinite(extTime) && Number.isFinite(incTime) && Math.abs(extTime - incTime) < 15000;

        if (sameBody && sameRecipient && closeTime) {
          matchedOptimisticId = id;
        }
      }
    });

    if (matchedOptimisticId) {
      const extMsg = byId.get(matchedOptimisticId)!;
      byId.delete(matchedOptimisticId);
      byId.set(incMsg.id, {
        ...incMsg,
        localSeq: extMsg.localSeq ?? incMsg.localSeq ?? getNextLocalSeq()
      });
    } else {
      const existingMsg = byId.get(incMsg.id);
      const localSeq = existingMsg?.localSeq ?? incMsg.localSeq ?? getNextLocalSeq();
      byId.set(incMsg.id, { ...incMsg, localSeq });
    }
  });

  return Array.from(byId.values()).sort((first, second) => {
    const firstTime = Date.parse(first.createdAt ?? "");
    const secondTime = Date.parse(second.createdAt ?? "");
    if (Number.isFinite(firstTime) && Number.isFinite(secondTime)) {
      if (firstTime !== secondTime) {
        return firstTime - secondTime;
      }
    }
    return (first.localSeq ?? 0) - (second.localSeq ?? 0);
  });
}

async function prepareUploadFile(file: File) {
  const canCompress =
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    file.type.startsWith("image/") &&
    file.type !== "image/gif" &&
    file.size > 1.5 * 1024 * 1024;
  if (!canCompress) return file;

  try {
    return await compressImageFile(file);
  } catch {
    return file;
  }
}

async function compressImageFile(file: File) {
  const source = URL.createObjectURL(file);
  try {
    const image = await loadImage(source);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], compressedImageName(file.name), { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(source);
  }
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not prepare image"));
    image.src = source;
  });
}

function compressedImageName(name: string) {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  return `${base}-compressed.jpg`;
}

function AttachmentPreview({ attachment, authToken }: { attachment: NonNullable<ChatMessage["attachment"]>; authToken: string }) {
  const [failed, setFailed] = useState(false);
  const source = attachmentSource(attachment.url, authToken);
  const canPreview = Boolean(source && /^(https?:|data:|blob:)/i.test(source) && !failed);

  if (attachment.kind === "image" && canPreview) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={attachment.name} className="mb-3 max-h-64 rounded-md object-cover" onError={() => setFailed(true)} src={source} />
    );
  }

  if (attachment.kind === "video" && canPreview) {
    return <video className="mb-3 max-h-64 rounded-md" controls onError={() => setFailed(true)} src={source} />;
  }

  return (
    <a className="mb-3 flex items-center gap-3 rounded-md border border-[#dce1e8] bg-white/70 px-3 py-3 text-sm font-bold text-[#334155]" href={source || undefined} download={attachment.name}>
      <FileText size={20} />
      <span className="min-w-0 truncate">{attachment.name}</span>
    </a>
  );
}

function attachmentSource(url: string, token: string) {
  if (!url) return "";
  if (url.startsWith("attachment:")) {
    const id = url.slice("attachment:".length);
    return `${apiUrl()}/api/v1/files/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`;
  }
  return url;
}

function ChatAvatar({ chat, className }: { chat: ChatSeed; className: string }) {
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden ${chat.color} font-black text-white ${className}`}>
      {chat.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={chat.name} className="h-full w-full object-cover" src={chat.avatarUrl} />
      ) : (
        chat.avatar
      )}
    </span>
  );
}

function nameFromEmail(email?: string) {
  const localPart = (email ?? "").split("@")[0] ?? "";
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Conversation";
}

function chatInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "C"}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function initials(firstName: string, lastName: string) {
  const first = firstName.trim()[0] ?? "C";
  const last = lastName.trim()[0] ?? "";
  return `${first}${last}`.toUpperCase();
}
