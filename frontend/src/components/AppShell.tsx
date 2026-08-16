"use client";

import { ChangeEvent, FormEvent, KeyboardEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  FileText,
  Image,
  Link,
  Loader2,
  LogOut,
  MessageCircle,
  Mic,
  MoreVertical,
  Paperclip,
  Mail,
  Search,
  Send,
  ShieldCheck,
  Smile,
  Upload,
  UserPlus,
  Users,
  Menu,
  X,
  Phone,
  Video,
  Play,
  Pause,
  Radio,
  Camera,
  ChevronLeft,
  ChevronRight,
  Eye,
  Plus,
  Trash2
} from "lucide-react";
import { ChatSeed, DirectoryUser, userToChat } from "@/lib/data";
import EmojiPicker, { EmojiClickData, Theme } from "emoji-picker-react";
import { AIChat, AIMessage } from "@/components/AIChat";
import { useAudioCall, AudioCallOverlay } from "./AudioCall";
import { handleImageCompressionLoop, handleVideoCompressionLoop, AppConfig } from "@/lib/mediaCompression";

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
    kind: "image" | "video" | "file" | "audio";
  };
  localSeq?: number;
  status?: "uploading" | "sending" | "sent" | "failed";
  progressMsg?: string;
  reactions?: ReactionSummary[];
};
type ReactionUser = { id: string; name: string };
type ReactionSummary = { emoji: string; count: number; reactedByMe?: boolean; users?: ReactionUser[] };
type ReactionTarget = { type: "direct" | "group"; messageId: string; groupId?: string };
type SharedAttachmentItem = { message: ChatMessage; attachment: NonNullable<ChatMessage["attachment"]>; source: string };
type SharedLinkItem = { message: ChatMessage; url: string };
type ContactInfoMediaTab = "media" | "links" | "files";
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

type CallHistoryEntry = {
  id: string;
  otherUser: { id: string; name: string; avatarUrl: string };
  direction: "incoming" | "outgoing";
  callType: "audio" | "video";
  status: "ringing" | "answered" | "missed" | "rejected" | "ended";
  startedAt: string;
  answeredAt?: string;
  endedAt?: string;
  durationSeconds: number;
};

type GroupSummary = {
  id: string;
  name: string;
  avatarUrl?: string;
  ownerId: string;
  role: "owner" | "admin" | "member";
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  latestMessage?: GroupChatMessage;
};

type GroupMember = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
};

type GroupDetails = GroupSummary & { members: GroupMember[] };

type GroupChatMessage = {
  id: string;
  groupId: string;
  senderId: string;
  senderEmail?: string;
  body: string;
  createdAt?: string;
  time?: string;
  mine?: boolean;
  attachment?: NonNullable<ChatMessage["attachment"]>;
  reactions?: ReactionSummary[];
};

type GroupMessageStore = Record<string, GroupChatMessage[]>;

type StatusEntry = {
  id: string;
  userId: string;
  type: "text" | "image" | "video";
  textContent?: string;
  mediaUrl?: string;
  caption?: string;
  background?: string;
  createdAt: string;
  expiresAt: string;
  viewed: boolean;
  user: { id: string; name: string; avatarUrl?: string };
};

type StatusPanelProps = {
  authToken: string;
  currentUserId: string;
  currentUser: { name: string; avatarUrl?: string };
  className?: string;
};

const BUILT_IN_AVATARS = Array.from({ length: 10 }, (_, index) => {
  const id = `avatar-${String(index + 1).padStart(2, "0")}`;
  return { id, src: `/avatars/${id}.png` };
});
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function isBuiltInAvatar(value?: string) {
  return BUILT_IN_AVATARS.some((avatar) => avatar.src === value);
}

function randomBuiltInAvatar() {
  return BUILT_IN_AVATARS[Math.floor(Math.random() * BUILT_IN_AVATARS.length)]?.src ?? BUILT_IN_AVATARS[0].src;
}

function formatCallDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatCallTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "long" });
  } else {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}

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
  const [selectedBuiltInAvatar, setSelectedBuiltInAvatar] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupMessages, setGroupMessages] = useState<GroupMessageStore>({});
  const [selectedGroupDetails, setSelectedGroupDetails] = useState<GroupDetails | null>(null);
  const [isGroupsLoading, setIsGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState("");
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
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
  const [reactionPicker, setReactionPicker] = useState<ReactionTarget | null>(null);
  const [reactionDetails, setReactionDetails] = useState<{ emoji: string; users: ReactionUser[] } | null>(null);
  const [isContactInfoOpen, setIsContactInfoOpen] = useState(false);
  const [contactInfoMediaTab, setContactInfoMediaTab] = useState<ContactInfoMediaTab | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig>({
    maxUploadSizeMb: 50,
    imageOptimizeThresholdBytes: 2097152,
    videoOptimizeThresholdBytes: 10485760,
    imageMaxDimension: 1920,
    videoMaxDimension: 1280
  });
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  const isTypingRef = useRef<boolean>(false);
  const typingTimeoutRef = useRef<number | null>(null);
  const [socketAttempt, setSocketAttempt] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const chatSearchRef = useRef<HTMLInputElement | null>(null);
  const chatMessageSearchRef = useRef<HTMLInputElement | null>(null);
  const selectedChatIdRef = useRef(selectedChatId);
  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    if (!reactionPicker) return;
    const handleClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest("[data-reaction-picker]")) setReactionPicker(null);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [reactionPicker]);

  useEffect(() => {
    if (!isContactInfoOpen && !contactInfoMediaTab) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setContactInfoMediaTab(null);
        setIsContactInfoOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contactInfoMediaTab, isContactInfoOpen]);

  useEffect(() => {
    if (!authToken) return;
    fetch(`${apiUrl()}/api/v1/config`, {
      headers: authHeaders(authToken)
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load config");
        return res.json();
      })
      .then((data) => {
        if (data && typeof data.maxUploadSizeMb === "number") {
          setAppConfig({
            maxUploadSizeMb: data.maxUploadSizeMb,
            imageOptimizeThresholdBytes: Number(data.imageOptimizeThresholdBytes) || 2097152,
            videoOptimizeThresholdBytes: Number(data.videoOptimizeThresholdBytes) || 10485760,
            imageMaxDimension: Number(data.imageMaxDimension) || 1920,
            videoMaxDimension: Number(data.videoMaxDimension) || 1280
          });
        }
      })
      .catch((err) => {
        console.error("[Config debug] Could not load backend config, using defaults:", err);
      });
  }, [authToken]);

  const {
    callState,
    callId,
    remoteUser,
    isMuted,
    callDuration,
    callType,
    isCameraOn,
    isRemoteCameraOn,
    localStream,
    remoteStream,
    facingMode,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
    switchCamera,
    handleSignalingEvent,
    inviteParticipant,
    participants,
    remoteStreams,
    participantsCameraOn,
    participantsMuted
  } = useAudioCall(currentUserId, socketRef, directoryChats);

  const endCallRef = useRef(endCall);
  const handleSignalingEventRef = useRef(handleSignalingEvent);

  useEffect(() => {
    endCallRef.current = endCall;
    handleSignalingEventRef.current = handleSignalingEvent;
  }, [endCall, handleSignalingEvent]);

  const callStateRef = useRef(callState);
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  const callIdRef = useRef(callId);
  useEffect(() => {
    callIdRef.current = callId;
  }, [callId]);

  const callReconnectTimeoutRef = useRef<any>(null);
  const reconnectCountRef = useRef(0);

  useEffect(() => {
    if (callState === "idle" || callState === "ended" || callState === "rejected") {
      if (callReconnectTimeoutRef.current) {
        window.clearTimeout(callReconnectTimeoutRef.current);
        callReconnectTimeoutRef.current = null;
      }
    }
  }, [callState]);

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
  const failedTasksRef = useRef<Map<string, {
    chatId: string;
    message: ChatMessage;
    draftText: string;
    draftAttachment: AttachmentDraft | null;
  }>>(new Map());

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
  const [mobileTab, setMobileTab] = useState<"chats" | "status" | "groups" | "calls">("chats");
  const [callHistory, setCallHistory] = useState<CallHistoryEntry[]>([]);
  const [isCallHistoryLoading, setIsCallHistoryLoading] = useState(false);
  const [callHistorySearch, setCallHistorySearch] = useState("");

  const fetchGroups = useCallback(async () => {
    if (!authToken) return;
    setIsGroupsLoading(true);
    try {
      const response = await fetch(`${apiUrl()}/api/v1/groups`, { headers: authHeaders(authToken) });
      if (!response.ok) throw new Error("Could not load groups");
      const data = await response.json();
      setGroups(Array.isArray(data.groups) ? data.groups : []);
      setGroupsError("");
    } catch (error) {
      setGroupsError(error instanceof Error ? error.message : "Could not load groups");
    } finally {
      setIsGroupsLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (mobileTab === "groups") fetchGroups();
  }, [fetchGroups, mobileTab]);

  const fetchCallHistory = useCallback(async () => {
    if (!authToken) return;
    setIsCallHistoryLoading(true);
    try {
      const res = await fetch(`${apiUrl()}/api/v1/calls/history?limit=50`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!res.ok) throw new Error("Failed to fetch call history");
      const data = await res.json();
      setCallHistory(data.calls || []);
    } catch (err) {
      console.error("Failed to fetch call history:", err);
    } finally {
      setIsCallHistoryLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (mobileTab === "calls") {
      fetchCallHistory();
    }
  }, [mobileTab, fetchCallHistory]);

  useEffect(() => {
    if ((callState === "ended" || callState === "rejected") && mobileTab === "calls") {
      const timer = setTimeout(() => fetchCallHistory(), 1500);
      return () => clearTimeout(timer);
    }
  }, [callState, mobileTab, fetchCallHistory]);

  const [aiMessages, setAiMessages] = useState<AIMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hello! I'm your AI assistant. Ask me anything!"
    }
  ]);
  const [aiInput, setAiInput] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [isInboxLoading, setIsInboxLoading] = useState(true);
  const [isDirectoryLoading, setIsDirectoryLoading] = useState(true);
  const [inboxError, setInboxError] = useState("");
  const [directoryError, setDirectoryError] = useState("");
  const [isRestoring, setIsRestoring] = useState(true);
  const [isAppInitializing, setIsAppInitializing] = useState(true);
  const [retryAttempt, setRetryAttempt] = useState(0);

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
  const selectedSharedMedia = useMemo<SharedAttachmentItem[]>(() => {
    return selectedMessages
      .filter((message) => message.attachment && (message.attachment.kind === "image" || message.attachment.kind === "video"))
      .map((message) => ({ message, attachment: message.attachment!, source: attachmentSource(message.attachment!.url, authToken) }));
  }, [authToken, selectedMessages]);
  const selectedSharedFiles = useMemo<SharedAttachmentItem[]>(() => {
    return selectedMessages
      .filter((message) => message.attachment && !["image", "video", "audio"].includes(message.attachment.kind))
      .map((message) => ({ message, attachment: message.attachment!, source: attachmentSource(message.attachment!.url, authToken) }));
  }, [authToken, selectedMessages]);
  const selectedSharedLinks = useMemo<SharedLinkItem[]>(() => {
    const urlPattern = /\bhttps?:\/\/[^\s<>"']+/gi;
    return selectedMessages.flatMap((message) => {
      const matches = message.body.match(urlPattern) ?? [];
      return matches.map((url) => ({ message, url: url.replace(/[),.;!?]+$/, "") }));
    });
  }, [selectedMessages]);
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
        chatId === selectedChatId ? 0 : messages.filter((message) => !message.mine && !message.readAt).length
      ])
    ) as Record<string, number>;
  }, [chatMessages, selectedChatId]);
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

  // Warm up connection to backend to bypass DNS/network latency in Android WebView
  useEffect(() => {
    fetch(`${apiUrl()}/health`).catch(() => {});
  }, []);

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
        const savedAvatar = profile.avatarPreview ?? "";
        setFirstName(profile.firstName ?? "");
        setLastName(profile.lastName ?? "");
        setAvatarPreview(savedAvatar);
        setSelectedBuiltInAvatar(isBuiltInAvatar(savedAvatar) ? savedAvatar : "");
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
    setSelectedGroupId("");
    setSelectedGroupDetails(null);
    setChatSearch("");
    setWorkspaceMode("inbox");
    setIsMobileAIChatOpen(false);
    setIsMobileDrawerOpen(false);
    setIsContactInfoOpen(false);
    setContactInfoMediaTab(null);
  }, [isAuthed]);

  useEffect(() => {
    if (!isRestoring) {
      if (!isAuthed) {
        setIsAppInitializing(false);
      } else if (!isInboxLoading && !inboxError) {
        setIsAppInitializing(false);
      }
    }
  }, [isRestoring, isAuthed, isInboxLoading, inboxError]);

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
          const readAt = new Date().toISOString();
          const processedMessages = chatId === selectedChatIdRef.current
            ? messages.map((m: ChatMessage) => (m.mine ? m : { ...m, readAt: m.readAt || readAt }))
            : messages;
          return {
            ...current,
            [chatId]: mergeMessages(existing, processedMessages)
          };
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [authToken, isAuthed, selectedChatId]);

  useEffect(() => {
    if (!isAuthed || !authToken || !selectedGroupId) return;
    let cancelled = false;
    const headers = authHeaders(authToken);
    Promise.all([
      fetch(`${apiUrl()}/api/v1/groups/${selectedGroupId}`, { headers }),
      fetch(`${apiUrl()}/api/v1/groups/${selectedGroupId}/messages?limit=100`, { headers })
    ])
      .then(async ([detailsResponse, messagesResponse]) => {
        if (!detailsResponse.ok || !messagesResponse.ok) throw new Error("Group could not be loaded");
        return { details: await detailsResponse.json(), messages: await messagesResponse.json() };
      })
      .then(({ details, messages }) => {
        if (cancelled) return;
        setSelectedGroupDetails(details.group ?? null);
        const loaded: GroupChatMessage[] = Array.isArray(messages.messages)
          ? messages.messages.map((message: GroupChatMessage) => ({ ...message, mine: message.senderId === currentUserId }))
          : [];
        setGroupMessages((current) => ({ ...current, [selectedGroupId]: loaded }));
      })
      .catch((error) => {
        if (!cancelled) setGroupsError(error instanceof Error ? error.message : "Could not load group");
      });
    return () => { cancelled = true; };
  }, [authToken, currentUserId, isAuthed, selectedGroupId]);

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
      reconnectCountRef.current = 0;
      if (callReconnectTimeoutRef.current) {
        console.log("WebSocket reconnected successfully during call. Clearing grace period.");
        window.clearTimeout(callReconnectTimeoutRef.current);
        callReconnectTimeoutRef.current = null;
      }
      if (callStateRef.current !== "idle" && callStateRef.current !== "ended" && callStateRef.current !== "rejected" && callIdRef.current) {
        console.log(`Re-sending call_join for active call after reconnect: ${callIdRef.current}`);
        socket.send(
          JSON.stringify({
            type: "call_join",
            payload: { callId: callIdRef.current }
          })
        );
      }
      // Reconcile pending/failed messages
      reconcilePendingMessagesRef.current();
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          type?: string;
          conversationId?: string;
          userId?: string;
          payload?: ChatMessage & { userId?: string; online?: boolean; lastSeenAt?: string; client_message_id?: string; message_id?: string; status?: string; error?: string; messageId?: string; messageType?: "direct" | "group"; groupId?: string; reactions?: ReactionSummary[] };
        };
        if (data.type && data.type.startsWith("call_")) {
          handleSignalingEventRef.current(data);
          return;
        }
        if (data.type === "message_sent" && data.payload) {
          const clientMsgId = data.payload.client_message_id;
          const serverMsgId = data.payload.message_id;
          const status = data.payload.status;
          
          if (clientMsgId) {
            if (status === "sent" && serverMsgId) {
              setChatMessages((current) => {
                const next = { ...current };
                Object.keys(next).forEach((chatId) => {
                  next[chatId] = (next[chatId] ?? []).map((msg) =>
                    msg.id === clientMsgId ? { ...msg, id: serverMsgId, status: "sent" } : msg
                  );
                });
                return next;
              });
            } else if (status === "failed") {
              setChatMessages((current) => {
                const next = { ...current };
                Object.keys(next).forEach((chatId) => {
                  next[chatId] = (next[chatId] ?? []).map((msg) =>
                    msg.id === clientMsgId ? { ...msg, status: "failed" } : msg
                  );
                });
                return next;
              });
              if (data.payload.error) {
                setChatNotice(data.payload.error);
              }
            }
          }
          return;
        }
        if (data.type === "presence.updated") {
          const userId = data.payload?.userId || data.userId;
          const online = Boolean(data.payload?.online);
          const lastSeenAt = data.payload?.lastSeenAt;
          if (!userId) return;
          setDirectoryChats((current) =>
            current.map((chat) => chat.id === userId ? { ...chat, online: chat.id === currentUserId ? true : online, ...(lastSeenAt ? { lastSeenAt } : {}) } : chat)
          );
          return;
        }
        if (data.type === "chat.read") {
          const payload = data.payload as unknown as { readerId?: string };
          const readerId = payload?.readerId;
          if (readerId && readerId !== currentUserId) {
            const readAt = new Date().toISOString();
            setChatMessages((current) => {
              const existing = current[readerId] ?? [];
              const updated = existing.map((msg) =>
                msg.mine ? { ...msg, readAt } : msg
              );
              return {
                ...current,
                [readerId]: updated
              };
            });
          }
          return;
        }
        if (data.type === "typing.start") {
          const payload = data.payload as unknown as { userId?: string; userName?: string };
          const userId = payload?.userId;
          const userName = payload?.userName;
          if (userId === selectedChatIdRef.current && userName) {
            setTypingUser(userName);
          }
          return;
        }
        if (data.type === "typing.stop") {
          const payload = data.payload as unknown as { userId?: string };
          const userId = payload?.userId;
          if (userId === selectedChatIdRef.current) {
            setTypingUser(null);
          }
          return;
        }
        if (data.type === "message.reaction" && data.payload?.messageId) {
          const payload = data.payload;
          if (payload.messageType === "group" && payload.groupId) {
            setGroupMessages((current) => ({
              ...current,
              [payload.groupId as string]: (current[payload.groupId as string] ?? []).map((message) =>
                message.id === payload.messageId ? { ...message, reactions: payload.reactions ?? [] } : message
              )
            }));
          } else {
            setChatMessages((current) => {
              const next = { ...current };
              Object.keys(next).forEach((chatId) => {
                next[chatId] = (next[chatId] ?? []).map((message) =>
                  message.id === payload.messageId ? { ...message, reactions: payload.reactions ?? [] } : message
                );
              });
              return next;
            });
          }
          return;
        }
        const groupPayload = data.payload as unknown as GroupChatMessage;
        if (data.type === "group.message" && groupPayload?.id && groupPayload?.groupId) {
          const payload = groupPayload;
          const incoming: GroupChatMessage = { ...payload, mine: payload.senderId === currentUserId };
          setGroupMessages((current) => {
            const existing = current[payload.groupId] ?? [];
            if (existing.some((message) => message.id === incoming.id)) return current;
            return { ...current, [payload.groupId]: [...existing, incoming] };
          });
          setGroups((current) => current.map((group) => group.id === payload.groupId ? { ...group, latestMessage: incoming, updatedAt: incoming.createdAt ?? group.updatedAt } : group));
          return;
        }
        if (data.type !== "chat.message" || !data.payload) return;
        if (!data.payload.id || !data.payload.time) return;
        if (data.payload.senderEmail?.toLowerCase() === email.toLowerCase()) return;
        if (currentUserId && data.payload.recipientId !== currentUserId) return;

        setChatMessages((current) => {
          const conversationId = data.payload?.senderId || data.conversationId;
          if (!conversationId) return current;
          const isOpen = conversationId === selectedChatIdRef.current;
          const readAt = isOpen ? new Date().toISOString() : undefined;
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
            readAt,
            reactions: data.payload?.reactions ?? [],
            localSeq: getNextLocalSeq()
          };
          if (isOpen && authToken) {
            fetch(`${apiUrl()}/api/v1/messages/${conversationId}/read`, {
              method: "POST",
              headers: authHeaders(authToken)
            }).catch(() => {});
          }
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
      setTypingUser(null);
      if (closedByCleanup) return;

      // Transition any "sending" or "uploading" messages to "failed" and save tasks
      setChatMessages((current) => {
        const next = { ...current };
        Object.entries(next).forEach(([chatId, messages]) => {
          next[chatId] = (messages ?? []).map((msg) => {
            if (msg.status === "sending" || msg.status === "uploading") {
              const taskIndex = pendingSendQueueRef.current.findIndex((t) => t.message.id === msg.id);
              if (taskIndex !== -1) {
                const task = pendingSendQueueRef.current[taskIndex];
                pendingSendQueueRef.current.splice(taskIndex, 1);
                failedTasksRef.current.set(msg.id, task);
              } else {
                failedTasksRef.current.set(msg.id, {
                  chatId,
                  message: msg,
                  draftText: msg.body,
                  draftAttachment: msg.attachment ? { ...msg.attachment } : null
                });
              }
              return { ...msg, status: "failed" };
            }
            return msg;
          });
        });
        return next;
      });

      if (callStateRef.current !== "idle" && callStateRef.current !== "ended" && callStateRef.current !== "rejected") {
        if (!callReconnectTimeoutRef.current) {
          console.log("WebSocket disconnected during an active call. Starting 15s grace period...");
          callReconnectTimeoutRef.current = window.setTimeout(() => {
            console.warn("WebSocket reconnection grace period expired. Ending call.");
            endCallRef.current();
            callReconnectTimeoutRef.current = null;
          }, 15000);
        }
      }

      const delay = Math.min(2500 * Math.pow(1.5, reconnectCountRef.current), 15000);
      reconnectCountRef.current += 1;
      console.log(`WebSocket disconnected. Reconnecting in ${delay}ms (attempt #${reconnectCountRef.current})`);
      reconnectTimer = window.setTimeout(() => setSocketAttempt((attempt) => attempt + 1), delay);
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
                online: chat.online || Boolean(previous?.online),
                lastSeenAt: chat.lastSeenAt || previous?.lastSeenAt
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
  }, [authToken, email, isAuthed, retryAttempt]);

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
          const chatId = message.senderEmail?.toLowerCase() === email.toLowerCase() ? message.recipientId : message.senderId;
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
  }, [authToken, currentUserId, email, isAuthed, retryAttempt]);

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
      setGroupMessages({});
      setGroups([]);
      setDrafts({});
      setDirectoryChats([]);
      setSelectedChatId("");
      setSelectedChatSnapshot(null);
      setCurrentUserId(user.id ?? "");
      setAuthToken(token);
      setFirstName(user.firstName ?? "");
      setLastName(user.lastName ?? "");
      const nextAvatar = user.avatarUrl && !String(user.avatarUrl).startsWith("uploaded:") ? user.avatarUrl : "";
      setAvatarPreview(nextAvatar);
      setSelectedBuiltInAvatar(isBuiltInAvatar(nextAvatar) ? nextAvatar : "");
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
    setSelectedBuiltInAvatar("");
    setAvatarPreview(URL.createObjectURL(file));
    event.target.value = "";
  }

  function chooseBuiltInAvatar(src: string) {
    setSelectedBuiltInAvatar(src);
    setAvatarFile(null);
    setAvatarPreview(src);
  }

  function applyReactionUpdate(target: ReactionTarget, reactions: ReactionSummary[]) {
    if (target.type === "group" && target.groupId) {
      setGroupMessages((current) => ({
        ...current,
        [target.groupId as string]: (current[target.groupId as string] ?? []).map((message) =>
          message.id === target.messageId ? { ...message, reactions } : message
        )
      }));
      return;
    }
    setChatMessages((current) => {
      const next = { ...current };
      Object.keys(next).forEach((chatId) => {
        next[chatId] = (next[chatId] ?? []).map((message) =>
          message.id === target.messageId ? { ...message, reactions } : message
        );
      });
      return next;
    });
  }

  async function reactToMessage(target: ReactionTarget, emoji: string) {
    if (!authToken) return;
    setReactionPicker(null);
    const endpoint = target.type === "group" && target.groupId
      ? `${apiUrl()}/api/v1/groups/${encodeURIComponent(target.groupId)}/messages/${encodeURIComponent(target.messageId)}/reactions`
      : `${apiUrl()}/api/v1/messages/reactions/${encodeURIComponent(target.messageId)}`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { ...authHeaders(authToken), "Content-Type": "application/json" },
        body: JSON.stringify({ emoji })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update reaction");
      applyReactionUpdate(target, Array.isArray(data.reactions) ? data.reactions : []);
    } catch (error) {
      setChatNotice(error instanceof Error ? error.message : "Could not update reaction");
    }
  }

  function handleFileAttachment(file: File) {
    const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file";
    const attachment: AttachmentDraft = {
      name: file.name,
      type: file.type || "application/octet-stream",
      url: URL.createObjectURL(file),
      kind,
      file,
    };
    if (selectedChatId) setDraftAttachment(selectedChatId, attachment);
  }

  function chooseAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    handleFileAttachment(file);
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
      const finalBuiltInAvatar = avatarFile ? "" : selectedBuiltInAvatar || randomBuiltInAvatar();
      if (!selectedBuiltInAvatar && finalBuiltInAvatar) {
        setSelectedBuiltInAvatar(finalBuiltInAvatar);
        setAvatarPreview(finalBuiltInAvatar);
      }
      const formData = new FormData();
      formData.set("email", email);
      formData.set("firstName", firstName.trim());
      formData.set("lastName", lastName.trim());
      formData.set("password", password);
      if (avatarFile) formData.set("avatar", avatarFile);
      if (!avatarFile && finalBuiltInAvatar) formData.set("builtInAvatar", finalBuiltInAvatar);

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
          avatarPreview: profile.avatarUrl ?? finalBuiltInAvatar
        })
      );
      setAvatarPreview(profile.avatarUrl ?? finalBuiltInAvatar);
      setAvatarFile(null);
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
      if (!avatarFile && selectedBuiltInAvatar) formData.set("builtInAvatar", selectedBuiltInAvatar);

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
      setSelectedBuiltInAvatar(isBuiltInAvatar(nextAvatar) ? nextAvatar : "");
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

  async function prepareUploadFile(
    file: File,
    kind: "image" | "video" | "file" | "audio",
    onProgress: (msg: string) => void
  ): Promise<File> {
    if (kind === "image" && file.type !== "image/gif") {
      try {
        return await handleImageCompressionLoop(file, appConfig, onProgress);
      } catch (err) {
        console.error("[Image Optimization debug] failed:", err);
        throw err;
      }
    } else if (kind === "video") {
      try {
        return await handleVideoCompressionLoop(file, appConfig, onProgress);
      } catch (err) {
        console.error("[Video Optimization debug] failed:", err);
        throw err;
      }
    }
    return file;
  }

  async function uploadAttachment(
    draft: AttachmentDraft,
    onProgress: (msg: string) => void
  ): Promise<NonNullable<ChatMessage["attachment"]>> {
    if (!draft.file) return draft;

    let file: File;
    try {
      file = await prepareUploadFile(draft.file, draft.kind, onProgress);
    } catch (err) {
      console.error("[Attachment debug] compression failed:", err);
      const errMsg = err instanceof Error ? err.message : "Compression failed";
      if (errMsg.includes("too large") || errMsg.includes("limit") || errMsg.includes("choose a shorter")) {
        throw new Error(`Video is still too large after compression. Please choose a shorter video.`);
      }
      throw new Error(`Could not optimize media. Retry`);
    }

    const formData = new FormData();
    formData.set("file", file, file.name);

    console.log("[Attachment debug] uploadAttachment - Starting upload for file name:", file.name, "size:", file.size, "type:", file.type);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${apiUrl()}/api/v1/upload`);
      xhr.setRequestHeader("Authorization", authHeaders(authToken)["Authorization"]);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(`Uploading... ${percent}%`);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            console.log("[Attachment debug] uploadAttachment - Upload succeeded. Response:", data);
            resolve({
              name: data.name ?? file.name ?? draft.name,
              type: data.type ?? file.type ?? draft.type,
              kind: data.kind ?? draft.kind,
              url: data.url ?? draft.url
            } as NonNullable<ChatMessage["attachment"]>);
          } catch (e) {
            reject(new Error("Invalid upload response"));
          }
        } else {
          try {
            const data = JSON.parse(xhr.responseText);
            console.error("[Attachment debug] uploadAttachment - Upload failed. Status:", xhr.status, "data:", data);
            reject(new Error(data.error ?? `Upload failed with status ${xhr.status}`));
          } catch (e) {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => {
        console.error("[Attachment debug] uploadAttachment - Network error during upload");
        reject(new Error("Network error during upload"));
      };

      xhr.send(formData);
    });
  }

  async function processSendQueue() {
    if (isProcessingQueueRef.current || pendingSendQueueRef.current.length === 0) return;
    isProcessingQueueRef.current = true;

    while (pendingSendQueueRef.current.length > 0) {
      const task = pendingSendQueueRef.current[0];
      const { chatId, message, draftText, draftAttachment } = task;

      let uploadedAttachment: NonNullable<ChatMessage["attachment"]> | undefined = message.attachment;
      let uploadFailed = false;

      const attachmentIsUploaded = message.attachment && !message.attachment.url.startsWith("blob:");

      if (draftAttachment && !attachmentIsUploaded) {
        try {
          // Set UI status to uploading with starting notice
          setChatMessages((current) => ({
            ...current,
            [chatId]: (current[chatId] ?? []).map((msg) =>
              msg.id === message.id ? { ...msg, status: "uploading", progressMsg: "Preparing..." } : msg
            )
          }));

          const onProgress = (progressText: string) => {
            setChatMessages((current) => ({
              ...current,
              [chatId]: (current[chatId] ?? []).map((msg) =>
                msg.id === message.id ? { ...msg, progressMsg: progressText } : msg
              )
            }));
          };

          uploadedAttachment = await uploadAttachment(draftAttachment, onProgress);
        } catch (error) {
          uploadFailed = true;
          const errorMsg = error instanceof Error ? error.message : "Could not upload file";
          setAuthError(errorMsg);
          setChatNotice(errorMsg);
          console.error("[VoiceMessage debug] processSendQueue - Attachment upload failed:", errorMsg);
          
          // Save task to failed tasks
          failedTasksRef.current.set(message.id, task);

          setChatMessages((current) => ({
            ...current,
            [chatId]: (current[chatId] ?? []).map((msg) =>
              msg.id === message.id ? { ...msg, status: "failed", progressMsg: errorMsg.startsWith("⚠") ? errorMsg : `⚠ ${errorMsg}` } : msg
            )
          }));
        }
      }

      if (uploadFailed) {
        pendingSendQueueRef.current.shift();
        continue;
      }

      if (uploadedAttachment && !attachmentIsUploaded) {
        message.attachment = uploadedAttachment;
        setChatMessages((current) => ({
          ...current,
          [chatId]: (current[chatId] ?? []).map((msg) =>
            msg.id === message.id ? { ...msg, attachment: uploadedAttachment, status: "sending", progressMsg: "Sending..." } : msg
          )
        }));
      }

      const socket = socketRef.current;
      let useWebSocket = socket && socket.readyState === WebSocket.OPEN;
      if (useWebSocket && socket) {
        try {
          // Set UI status to sending
          setChatMessages((current) => ({
            ...current,
            [chatId]: (current[chatId] ?? []).map((msg) =>
              msg.id === message.id ? { ...msg, status: "sending", progressMsg: "Sending..." } : msg
            )
          }));

          socket.send(
            JSON.stringify({
              type: "message_send",
              payload: {
                client_message_id: message.id,
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
              }
            })
          );
          console.log("[WebSocket debug] message_send sent via WS for client ID:", message.id);
        } catch (error) {
          console.error("[WebSocket debug] failed to send via WS, falling back to HTTP:", error);
          useWebSocket = false;
        }
      }

      if (!useWebSocket) {
        try {
          // Set UI status to sending
          setChatMessages((current) => ({
            ...current,
            [chatId]: (current[chatId] ?? []).map((msg) =>
              msg.id === message.id ? { ...msg, status: "sending", progressMsg: "Sending..." } : msg
            )
          }));

          console.log("[VoiceMessage debug] processSendQueue - Sending message endpoint payload:", {
            recipientId: chatId,
            body: message.body,
            attachment: uploadedAttachment
          });
          const response = await fetch(`${apiUrl()}/api/v1/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders(authToken) },
            body: JSON.stringify({
              id: message.id, // client-generated ID
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
          if (!response.ok) {
            console.error("[VoiceMessage debug] processSendQueue - Save message returned error. Status:", response.status, "data:", data);
            throw new Error(data.error ?? `Message send failed with status ${response.status}`);
          }
          console.log("[VoiceMessage debug] processSendQueue - Message send succeeded. Data:", data);
          if (data.message?.id) {
            setChatMessages((current) => ({
              ...current,
              [chatId]: (current[chatId] ?? []).map((currentMessage) =>
                currentMessage.id === message.id
                  ? { ...data.message, mine: true, status: "sent", localSeq: currentMessage.localSeq, createdAt: currentMessage.createdAt }
                  : currentMessage
              )
            }));
          }
        } catch (error) {
          console.error("[VoiceMessage debug] processSendQueue - Send message catch hit:", error);
          
          failedTasksRef.current.set(message.id, {
            chatId,
            message: { ...message, attachment: uploadedAttachment },
            draftText,
            draftAttachment: (uploadedAttachment && draftAttachment) ? ({ ...draftAttachment, url: uploadedAttachment.url, file: undefined } as AttachmentDraft) : draftAttachment
          });

          setChatMessages((current) => ({
            ...current,
            [chatId]: (current[chatId] ?? []).map((currentMessage) =>
              currentMessage.id === message.id ? { ...currentMessage, status: "failed" } : currentMessage
            )
          }));
          setChatNotice(error instanceof Error ? error.message : "Message could not be saved");
        }
      }

      pendingSendQueueRef.current.shift();
    }

    isProcessingQueueRef.current = false;
  }

  const retryMessage = useCallback((failedMessage: ChatMessage) => {
    const task = failedTasksRef.current.get(failedMessage.id);
    if (!task) return;

    failedTasksRef.current.delete(failedMessage.id);

    // Update status in UI to uploading or sending
    const initialStatus = (task.draftAttachment && !task.message.attachment?.url.startsWith("http")) ? "uploading" : "sending";
    const initialProgress = initialStatus === "uploading" ? "Preparing..." : "Sending...";
    
    setChatMessages((current) => ({
      ...current,
      [task.chatId]: (current[task.chatId] ?? []).map((msg) =>
        msg.id === failedMessage.id ? { ...msg, status: initialStatus, progressMsg: initialProgress } : msg
      )
    }));

    // Queue it back
    pendingSendQueueRef.current.push(task);
    processSendQueue();
  }, []);

  const reconcilePendingMessages = useCallback(() => {
    if (failedTasksRef.current.size === 0) return;
    console.log(`WebSocket reconnected. Reconciling ${failedTasksRef.current.size} failed messages...`);
    const tasks = Array.from(failedTasksRef.current.values());
    for (const task of tasks) {
      failedTasksRef.current.delete(task.message.id);
      
      const initialStatus = (task.draftAttachment && !task.message.attachment?.url.startsWith("http")) ? "uploading" : "sending";
      const initialProgress = initialStatus === "uploading" ? "Preparing..." : "Sending...";
      setChatMessages((current) => ({
        ...current,
        [task.chatId]: (current[task.chatId] ?? []).map((msg) =>
          msg.id === task.message.id ? { ...msg, status: initialStatus, progressMsg: initialProgress } : msg
        )
      }));

      pendingSendQueueRef.current.push(task);
    }
    processSendQueue();
  }, []);

  const reconcilePendingMessagesRef = useRef(reconcilePendingMessages);
  useEffect(() => {
    reconcilePendingMessagesRef.current = reconcilePendingMessages;
  }, [reconcilePendingMessages]);

  async function sendTypingStatus(event: "start" | "stop", targetId?: string) {
    const chatId = targetId ?? selectedChatId;
    if (!chatId || !authToken) return;
    try {
      await fetch(`${apiUrl()}/api/v1/messages/typing`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(authToken) },
        body: JSON.stringify({ recipientId: chatId, event })
      });
    } catch {
      // Ignore network errors for typing status
    }
  }

  const handleInputChange = (value: string) => {
    if (!selectedChatId) return;
    setDraftText(selectedChatId, value);

    if (!authToken) return;

    if (value.trim().length > 0) {
      if (!isTypingRef.current) {
        isTypingRef.current = true;
        sendTypingStatus("start");
      }

      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = window.setTimeout(() => {
        sendTypingStatus("stop");
        isTypingRef.current = false;
        typingTimeoutRef.current = null;
      }, 2000);
    } else {
      if (isTypingRef.current) {
        sendTypingStatus("stop");
        isTypingRef.current = false;
        if (typingTimeoutRef.current) {
          window.clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }
      }
    }
  };

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
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
      localSeq: getNextLocalSeq(),
      status: draftAttachment ? "uploading" : "sending"
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

    if (isTypingRef.current) {
      sendTypingStatus("stop", chatId);
      isTypingRef.current = false;
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    }
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

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, []);

  async function startRecording() {
    if (typeof window === "undefined" || !navigator.mediaDevices || !window.MediaRecorder) {
      setAuthError("Voice recording is not supported in this browser.");
      return;
    }
    try {
      const startTime = Date.now();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      
      let mimeType = "audio/webm";
      if (typeof MediaRecorder.isTypeSupported === "function") {
        if (MediaRecorder.isTypeSupported("audio/webm")) {
          mimeType = "audio/webm";
        } else if (MediaRecorder.isTypeSupported("audio/ogg")) {
          mimeType = "audio/ogg";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        } else if (MediaRecorder.isTypeSupported("audio/aac")) {
          mimeType = "audio/aac";
        }
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        stream.getTracks().forEach((track) => track.stop());
        
        const duration = Math.max(1, Math.round((Date.now() - startTime) / 1000));
        console.log("[VoiceMessage debug] onstop - Calculated voice message duration:", duration, "seconds");
        if (audioChunksRef.current.length > 0 && audioBlob.size > 0) {
          await handleSendVoiceBlob(audioBlob, duration);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      recordingTimerRef.current = window.setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Failed to start recording:", err);
      setAuthError("Microphone permission denied or recording failed");
    }
  }

  function cancelRecording() {
    if (!mediaRecorderRef.current) return;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    mediaRecorderRef.current.onstop = () => {
      const stream = mediaRecorderRef.current?.stream;
      stream?.getTracks().forEach((track) => track.stop());
    };
    mediaRecorderRef.current.stop();
    setIsRecording(false);
    setRecordingDuration(0);
  }

  function stopAndSendRecording() {
    if (!mediaRecorderRef.current) return;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    mediaRecorderRef.current.stop();
    setIsRecording(false);
  }

  async function handleSendVoiceBlob(blob: Blob, duration: number) {
    if (duration <= 0) {
      setAuthError("Recording is empty or too short");
      return;
    }
    const chatId = selectedChatId;
    if (!chatId || !authToken) return;

    if (selectedChatBlocked) {
      setChatNotice("You blocked this user. Unblock them before sending messages.");
      return;
    }

    const extension = blob.type.split("/")[1]?.split(";")[0] || "webm";
    const filename = `voice-message_${duration}s.${extension}`;
    const voiceFile = new File([blob], filename, { type: blob.type });

    const localUrl = URL.createObjectURL(blob);

    const draftAttachment: AttachmentDraft = {
      name: filename,
      type: blob.type,
      kind: "audio",
      url: localUrl,
      file: voiceFile
    };

    const message: ChatMessage = {
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      body: "",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      mine: true,
      senderEmail: email,
      recipientId: chatId,
      attachment: {
        name: filename,
        type: blob.type,
        url: localUrl,
        kind: "audio"
      },
      createdAt: new Date().toISOString(),
      localSeq: getNextLocalSeq(),
      status: "uploading"
    };

    setChatMessages((current) => ({
      ...current,
      [chatId]: mergeMessages(current[chatId] ?? [], [message])
    }));

    pendingSendQueueRef.current.push({
      chatId,
      message,
      draftText: "",
      draftAttachment
    });

    processSendQueue();
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
    setIsAppInitializing(true);
    setWorkspaceMode("inbox");
    setSelectedChatId("");
    setSelectedChatSnapshot(null);
    setIsMobileAIChatOpen(false);
    setIsMobileDrawerOpen(false);
    setChatSearch("");
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
    setSelectedBuiltInAvatar("");
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
    if (selectedChatId && isTypingRef.current) {
      sendTypingStatus("stop", selectedChatId);
    }
    setSelectedChatId(chat.id);
    setSelectedChatSnapshot(chat);
    setSelectedGroupId("");
    setSelectedGroupDetails(null);
    setIsChatMenuOpen(false);
    setIsContactInfoOpen(false);
    setContactInfoMediaTab(null);
    setTypingUser(null);
    isTypingRef.current = false;
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }

  function selectGroup(groupId: string) {
    setSelectedChatId("");
    setSelectedChatSnapshot(null);
    setSelectedGroupId(groupId);
    setSelectedGroupDetails(null);
    setIsGroupInfoOpen(false);
    setIsContactInfoOpen(false);
    setContactInfoMediaTab(null);
    setMobileTab("groups");
  }

  function closeCurrentGroup() {
    setSelectedGroupId("");
    setSelectedGroupDetails(null);
    setIsGroupInfoOpen(false);
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

  function openChatSearchFromContactInfo() {
    setIsChatSearchOpen(true);
    setIsChatMenuOpen(false);
    window.setTimeout(() => chatMessageSearchRef.current?.focus(), 0);
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
    if (selectedChatId && isTypingRef.current) {
      sendTypingStatus("stop", selectedChatId);
    }
    setSelectedChatId("");
    setSelectedChatSnapshot(null);
    setSelectedGroupId("");
    setSelectedGroupDetails(null);
    setIsChatSearchOpen(false);
    setIsContactInfoOpen(false);
    setContactInfoMediaTab(null);
    setChatMessageSearch("");
    setIsChatMenuOpen(false);
    setTypingUser(null);
    isTypingRef.current = false;
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
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

  if (isAppInitializing) {
    return (
      <main className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0b1120] text-white px-6">
        <div className="flex flex-col items-center max-w-sm w-full text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#00a884] text-[#0b1120] shadow-[0_16px_40px_rgba(0,168,132,.3)] transition-transform duration-500 hover:scale-105">
            <MessageCircle size={36} />
          </div>
          
          <h1 className="mt-8 text-3xl font-black tracking-normal text-white">ChatSphere</h1>
          
          {inboxError || directoryError ? (
            <div className="mt-6 w-full">
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-center">
                <p className="text-sm font-semibold text-red-200">
                  {inboxError || directoryError || "Failed to initialize ChatSphere"}
                </p>
              </div>
              <button
                className="cs-press mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#00a884] py-3 text-sm font-black text-[#0b1120] shadow-[0_8px_24px_rgba(0,168,132,.25)] hover:bg-[#00c298] transition"
                onClick={() => {
                  setInboxError("");
                  setDirectoryError("");
                  setRetryAttempt((current) => current + 1);
                }}
                type="button"
              >
                Retry Connection
              </button>
            </div>
          ) : (
            <div className="mt-8 flex flex-col items-center gap-4">
              <Loader2 className="animate-spin text-[#00a884]" size={36} />
              <p className="text-sm font-bold text-[#94a3b8] tracking-wide animate-pulse">
                Initializing secure session...
              </p>
            </div>
          )}
        </div>
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
          <div className="hidden lg:block cs-fade-up-delay max-w-2xl">
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

          <div className="cs-auth-card w-full max-w-md mx-auto lg:max-w-none rounded-2xl border border-white/10 bg-[#101b17] p-6 shadow-[0_30px_90px_rgba(0,0,0,.38)]">
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
                <AvatarSelection
                  currentPreview={avatarPreview}
                  inputId="onboarding-avatar-upload"
                  labelTone="dark"
                  onChooseBuiltIn={chooseBuiltInAvatar}
                  onChooseGallery={chooseAvatar}
                  selectedBuiltInAvatar={selectedBuiltInAvatar}
                  title="Choose your profile picture"
                />
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
    <main className="h-screen overflow-hidden bg-[#eef1f5] text-[#18212f] flex flex-col">
      {/* Mobile Top Navbar */}
      <header className="flex h-16 shrink-0 items-center justify-between bg-[#0b1120] px-4 text-white lg:hidden z-30 shadow-md">
        <div className="flex items-center gap-3">
          <button
            aria-label={isMobileDrawerOpen ? "Close menu" : "Open menu"}
            onClick={() => setIsMobileDrawerOpen(!isMobileDrawerOpen)}
            className="cs-press grid h-10 w-10 place-items-center rounded-xl text-[#94a3b8] hover:bg-white/10 hover:text-white transition focus:outline-none"
            type="button"
          >
            {isMobileDrawerOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          <span className="text-base font-black tracking-tight">ChatSphere</span>
        </div>
        <button
          className="grid h-9 w-9 place-items-center overflow-hidden rounded-lg bg-white/10 text-xs font-black text-[#00a884] hover:bg-white/20"
          onClick={() => {
            setIsProfileEditorOpen(true);
            setProfileError("");
            setProfileMessage("");
          }}
          title="Edit your profile"
          type="button"
          >
          {avatarPreview ? (
            <AvatarImage alt="Your profile" className="h-full w-full object-cover" fallback={userInitials} src={avatarPreview} />
          ) : (
            userInitials
          )}
        </button>
      </header>

      {/* Mobile Drawer (Left Sidebar) */}
      <div className={`fixed inset-0 z-50 flex lg:hidden transition-opacity duration-300 ${isMobileDrawerOpen ? "pointer-events-auto" : "pointer-events-none"}`}>
        <div
          className={`fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${isMobileDrawerOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setIsMobileDrawerOpen(false)}
        />
        <div
          className={`relative flex w-full max-w-[280px] flex-col bg-[#0b1120] text-white shadow-2xl transition-transform duration-300 ease-in-out h-full ${
            isMobileDrawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-[#7c3aed] to-[#3b82f6] text-white">
                <MessageCircle size={18} />
              </span>
              <span className="text-base font-black tracking-tight">ChatSphere</span>
            </div>
            <button
              aria-label="Close menu"
              onClick={() => setIsMobileDrawerOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-lg text-[#94a3b8] hover:bg-white/10 hover:text-white transition"
              type="button"
            >
              <X size={18} />
            </button>
          </div>

          <nav className="flex-1 space-y-1.5 px-4 py-6">
            {[
              { label: "Chats", mode: "inbox" as const, icon: MessageCircle },
              { label: "Search", mode: "search" as const, icon: Search },
              { label: "Users", mode: "contacts" as const, icon: Users },
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
                  onClick={() => {
                    openWorkspace(mode);
                    setIsMobileDrawerOpen(false);
                  }}
                  type="button"
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          <div className="border-t border-white/10 p-4">
            <button
              aria-label="Logout"
              className="cs-press flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#94a3b8] transition hover:bg-white/5 hover:text-white"
              onClick={() => {
                logout();
                setIsMobileDrawerOpen(false);
              }}
              type="button"
            >
              <LogOut size={18} />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </div>

      <section
        className={`grid h-full flex-1 min-h-0 ${
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
        <aside className={`flex h-full min-h-0 flex-col overflow-hidden border-r border-[#dce1e8] bg-white ${selectedChat || selectedGroupId ? "hidden lg:flex" : "flex"}`}>
          {mobileTab === "calls" ? (
            <>
              <header className="border-b border-[#e5e9f0] px-5 py-5">
                <div className="hidden lg:flex items-center justify-between gap-3">
                  <h1 className="text-2xl font-black tracking-normal">Calls</h1>
                </div>
                <label className="mt-5 lg:mt-3 flex h-11 items-center gap-3 rounded-xl border border-[#dce1e8] bg-[#f7f9fb] px-3 text-[#64748b]">
                  <Search size={19} />
                  <input
                    className="w-full bg-transparent text-sm outline-none focus-visible:!outline-none placeholder:text-[#94a3b8]"
                    onChange={(e) => setCallHistorySearch(e.target.value)}
                    placeholder="Search calls"
                    value={callHistorySearch}
                  />
                </label>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 pb-24 lg:pb-4">
                <div className="mb-3 flex items-center justify-between px-2">
                  <h2 className="text-sm font-black">Recent</h2>
                </div>
                {isCallHistoryLoading ? (
                  <div className="space-y-3">
                    {[1,2,3,4,5].map(i => (
                      <div key={i} className="flex items-center gap-3 rounded-2xl p-3">
                        <div className="cs-skeleton h-12 w-12 rounded-2xl" />
                        <div className="flex-1 space-y-2">
                          <div className="cs-skeleton h-4 w-32" />
                          <div className="cs-skeleton h-3 w-24" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : callHistory.filter(c => !callHistorySearch.trim() || c.otherUser.name.toLowerCase().includes(callHistorySearch.toLowerCase())).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-5 py-10 text-center">
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#e7f8f2] text-[#00a884]">
                      <Phone size={24} />
                    </div>
                    <h2 className="mt-5 text-base font-black">{callHistorySearch.trim() ? "No matching calls" : "No calls yet"}</h2>
                    <p className="mt-2 text-sm leading-6 text-[#64748b]">{callHistorySearch.trim() ? "Try a different search term." : "Your call history will appear here after you make or receive calls."}</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {callHistory
                      .filter(c => !callHistorySearch.trim() || c.otherUser.name.toLowerCase().includes(callHistorySearch.toLowerCase()))
                      .map(call => {
                        const isMissed = call.status === "missed" || call.status === "rejected";
                        const directionIcon = call.direction === "outgoing" ? "↗" : "↙";
                        return (
                          <div
                            key={call.id}
                            className="flex w-full items-center gap-3 rounded-2xl p-3 text-left transition hover:bg-[#f8fafc]"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                const chatSeed = directoryChats.find(c => c.id === call.otherUser.id);
                                if (chatSeed) selectChat(chatSeed);
                              }
                            }}
                            onClick={() => {
                              const chatSeed = directoryChats.find(c => c.id === call.otherUser.id);
                              if (chatSeed) selectChat(chatSeed);
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#e7f8f2] text-sm font-black text-[#008f70]">
                              {call.otherUser.avatarUrl ? (
                                <AvatarImage alt={call.otherUser.name} className="h-full w-full object-cover" fallback={chatInitials(call.otherUser.name)} src={call.otherUser.avatarUrl} />
                              ) : (
                                chatInitials(call.otherUser.name)
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className={`truncate text-sm font-bold ${isMissed ? "text-[#ef4444]" : "text-[#18212f]"}`}>{call.otherUser.name}</div>
                              <div className={`mt-0.5 flex items-center gap-1 text-xs ${isMissed ? "text-[#ef4444]" : "text-[#64748b]"}`}>
                                <span>{directionIcon}</span>
                                <span className="capitalize">{call.direction}</span>
                                <span>·</span>
                                {call.callType === "video" ? <Video size={12} /> : <Phone size={12} />}
                                {call.status === "ended" && call.durationSeconds > 0 ? (
                                  <><span>·</span><span>{formatCallDuration(call.durationSeconds)}</span></>
                                ) : (
                                  <><span>·</span><span className="capitalize">{call.status}</span></>
                                )}
                              </div>
                              <div className="mt-0.5 text-[11px] text-[#94a3b8]">{formatCallTime(call.startedAt)}</div>
                            </div>
                            <button
                              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#00a884] hover:bg-[#e7f8f2] transition"
                              onClick={(e) => {
                                e.stopPropagation();
                                const chatSeed = directoryChats.find(c => c.id === call.otherUser.id);
                                if (chatSeed) startCall(chatSeed, call.callType);
                              }}
                              type="button"
                            >
                              {call.callType === "video" ? <Video size={20} /> : <Phone size={20} />}
                            </button>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </>
          ) : mobileTab === "groups" ? (
            <GroupListPanel
              authToken={authToken}
              currentUserId={currentUserId}
              groups={groups}
              users={directoryChats}
              isLoading={isGroupsLoading}
              error={groupsError}
              onSelect={selectGroup}
              onRefresh={fetchGroups}
              className="hidden lg:flex"
            />
          ) : mobileTab === "status" ? (
            <StatusPanel
              authToken={authToken}
              currentUserId={currentUserId}
              currentUser={{ name: `${firstName} ${lastName}`.trim() || "You", avatarUrl: avatarPreview }}
              className="hidden lg:flex"
            />
          ) : (
            <>
          <header className="border-b border-[#e5e9f0] px-3 py-3 lg:px-5 lg:py-5">
            <div className="hidden lg:flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[#00a884]">Chatsphere</p>
                <h1 className="mt-2 text-2xl font-black tracking-normal">{workspaceTitle}</h1>
              </div>
              <button className="hidden lg:grid h-11 w-11 place-items-center overflow-hidden rounded-xl text-sm font-black text-[#008f70]" onClick={() => {
                setIsProfileEditorOpen(true);
                setProfileError("");
                setProfileMessage("");
              }} title="Edit your profile" type="button">
                {avatarPreview ? (
                  <AvatarImage alt="Your profile" className="h-full w-full object-cover" fallback={userInitials} src={avatarPreview} />
                ) : (
                  userInitials
                )}
              </button>
            </div>
            <div className="mt-5 hidden lg:grid grid-cols-2 gap-2">
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
            <label className="mt-3 flex h-11 items-center gap-3 rounded-xl border border-[#dce1e8] bg-[#f7f9fb] px-3 text-[#64748b] lg:mt-5">
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

          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-3 pb-24 lg:px-3 lg:py-4 lg:pb-4">
            <div className="mb-2 flex items-center justify-between px-2 lg:mb-3">
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
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#e7f8f2] text-[#00a884]">
                        <FileText size={20} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-sm">{message.attachment?.name}</strong>
                        <span className="mt-1 block truncate text-sm text-[#64748b]">{chat?.name ?? "Unknown chat"} - {formatMessageTime(message)}</span>
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
                      className={`cs-hover-lift flex min-w-0 max-w-full w-full items-start gap-3 rounded-2xl border p-3 text-left transition ${
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
                          <span className="text-xs font-bold text-[#94a3b8]">
                            {chatMessages[chat.id]?.at(-1) ? formatMessageTime(chatMessages[chat.id].at(-1)) : "new"}
                          </span>
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
                        className={`cs-hover-lift flex min-w-0 max-w-full w-full items-start gap-3 rounded-2xl border p-3 text-left transition ${
                          selectedChatId === chat.id ? "border-[#00a884] bg-[#effdf8] shadow-sm" : "border-transparent bg-white hover:border-[#e5e9f0] hover:bg-[#f8fafc]"
                        }`}
                        type="button"
                      >
                        <ChatAvatar chat={chat} className="h-11 w-11 rounded-xl text-sm" />
                        <span className="min-w-0 flex-1 overflow-hidden">
                          <span className="flex items-center justify-between gap-2">
                            <strong className="truncate text-sm">{chat.name}</strong>
                            <span className="shrink-0 text-xs font-bold text-[#94a3b8]">{formatMessageTime(lastMessage)}</span>
                          </span>
                          <span className="mt-1 flex items-center justify-between gap-2 text-sm text-[#64748b]">
                            <span className="min-w-0 truncate">{attachmentPreviewLabel(lastMessage) || (chat.online ? "Online now" : formatLastSeen(chat.lastSeenAt))}</span>
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
          </>
          )}
          {/* Desktop tab bar */}
          <div className="hidden shrink-0 items-center justify-around border-t border-[#e5e9f0] bg-white px-2 py-2 lg:flex">
            {([
              { key: "chats" as const, label: "Chats", icon: MessageCircle },
              { key: "status" as const, label: "Status", icon: Radio },
              { key: "groups" as const, label: "Groups", icon: Users },
              { key: "calls" as const, label: "Calls", icon: Phone },
            ]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={`flex flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                  mobileTab === key
                    ? "text-[#00a884]"
                    : "text-[#94a3b8] hover:text-[#64748b]"
                }`}
                onClick={() => setMobileTab(key)}
                type="button"
              >
                <Icon size={20} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </aside>
        ) : null}

        <section className={`h-full lg:h-screen min-h-0 flex-col overflow-hidden bg-[#f7f9fb] ${selectedChat || selectedGroupId || workspaceMode === "ai" ? "flex" : "hidden lg:flex"}`}>
          {workspaceMode === "ai" ? (
            <AIChat
              apiUrl={apiUrl()}
              authToken={authToken}
              messages={aiMessages}
              setMessages={setAiMessages}
              input={aiInput}
              setInput={setAiInput}
              isLoading={isAiLoading}
              setIsLoading={setIsAiLoading}
              error={aiError}
              setError={setAiError}
            />
          ) : selectedGroupId ? (
            <GroupChatPanel
              authToken={authToken}
              currentUserId={currentUserId}
              currentUserName={`${firstName} ${lastName}`.trim() || email}
              details={selectedGroupDetails}
              messages={groupMessages[selectedGroupId] ?? []}
              reactionPicker={reactionPicker}
              setReactionPicker={setReactionPicker}
              users={directoryChats}
              onBack={closeCurrentGroup}
              onReact={reactToMessage}
              onReactionDetails={setReactionDetails}
              onRefresh={async () => { await fetchGroups(); if (selectedGroupId) { const response = await fetch(`${apiUrl()}/api/v1/groups/${selectedGroupId}`, { headers: authHeaders(authToken) }); if (response.ok) { const data = await response.json(); setSelectedGroupDetails(data.group ?? null); } } }}
              onMessage={(message) => setGroupMessages((current) => { const existing = current[selectedGroupId] ?? []; return existing.some((item) => item.id === message.id) ? current : { ...current, [selectedGroupId]: [...existing, message] }; })}
              onLeave={() => { closeCurrentGroup(); fetchGroups(); }}
            />
          ) : selectedChat ? (
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="flex min-w-0 flex-1 flex-col">
              <header className="flex min-h-[82px] items-center justify-between gap-3 border-b border-[#e5e9f0] bg-white px-4 sm:px-6">
                <div className={`min-w-0 items-center gap-3 sm:gap-4 ${isChatSearchOpen ? "hidden sm:flex" : "flex"}`}>
                  <button aria-label="Back to chats" className="cs-press grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#64748b] hover:bg-[#f1f5f9] lg:hidden" onClick={closeCurrentChat} type="button">
                    <ArrowLeft size={22} />
                  </button>
                  <button className="flex min-w-0 items-center gap-3 rounded-2xl pr-2 text-left transition hover:bg-[#f8fafc] sm:gap-4" onClick={() => setIsContactInfoOpen(true)} type="button">
                    <ChatAvatar chat={selectedChat} className="h-12 w-12 rounded-2xl text-base" />
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-black">{selectedChat.name}</h2>
                    <p className={`text-sm font-semibold ${selectedChat.online ? "text-[#00a884]" : "text-[#94a3b8]"}`}>{selectedChat.online ? "Online" : formatLastSeen(selectedChat.lastSeenAt)}</p>
                  </div>
                  </button>
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
                  {selectedChat.id !== "chatsphere-ai" && (
                    <>
                      <button
                        aria-label="Start audio call"
                        className="cs-press grid h-10 w-10 place-items-center rounded-xl hover:bg-[#f1f5f9] text-[#64748b]"
                        onClick={() => startCall(selectedChat, "audio")}
                        type="button"
                      >
                        <Phone size={21} />
                      </button>
                      <button
                        aria-label="Start video call"
                        className="cs-press grid h-10 w-10 place-items-center rounded-xl hover:bg-[#f1f5f9] text-[#64748b]"
                        onClick={() => startCall(selectedChat, "video")}
                        type="button"
                      >
                        <Video size={21} />
                      </button>
                    </>
                  )}
                  <button aria-label="Chat options" className="cs-press grid h-10 w-10 place-items-center rounded-xl hover:bg-[#f1f5f9]" onClick={() => setIsChatMenuOpen((open) => !open)} type="button">
                    <MoreVertical size={23} />
                  </button>
                  {isChatMenuOpen ? (
                    <div className="cs-scale-in absolute right-0 top-12 z-30 w-56 overflow-hidden rounded-2xl border border-[#dce1e8] bg-white py-2 text-sm font-bold text-[#334155] shadow-[0_18px_45px_rgba(15,23,42,.14)]">
                      <div className="border-b border-[#edf1f5] px-4 py-3">
                        <div className="truncate text-[#18212f]">{selectedChat.name}</div>
                        <div className={`mt-1 text-xs ${selectedChat.online ? "text-[#00a884]" : "text-[#94a3b8]"}`}>{selectedChat.online ? "Online" : formatLastSeen(selectedChat.lastSeenAt)}</div>
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
                        <div className={`flex max-w-[72%] flex-col ${message.mine ? "items-end" : "items-start"}`}>
                          {message.attachment && message.attachment.kind === "audio" ? (
                            <VoiceMessageBubble message={message} authToken={authToken} selectedChat={selectedChat} onRetry={retryMessage} />
                          ) : (
                            <div className={`max-w-full rounded-2xl border px-4 py-3 shadow-sm ${message.mine ? "border-[#00a884]/20 bg-[#dff8ef]" : "border-[#e5e9f0] bg-white"}`}>
                              {message.attachment ? <AttachmentPreview attachment={message.attachment} authToken={authToken} /> : null}
                              {message.body ? <p className="text-sm leading-6 text-[#18212f]">{message.body}</p> : null}
                              <div className="mt-2 flex justify-end gap-1 text-xs font-semibold text-[#94a3b8]">
                                {formatMessageTime(message)}
                                {message.mine ? (
                                  <div className="flex items-center gap-1">
                                    {message.status === "uploading" ? (
                                      <span>{message.progressMsg || "Uploading..."}</span>
                                    ) : message.status === "sending" ? (
                                      <span>{message.progressMsg || "Sending..."}</span>
                                    ) : message.status === "failed" ? (
                                      <span className="text-[#b42318] flex items-center gap-1">
                                        <span>{message.progressMsg || "⚠ Failed"}</span>
                                        <button
                                          onClick={() => retryMessage(message)}
                                          className="underline font-bold text-sky-600 hover:text-sky-800 ml-1 cursor-pointer focus:outline-none"
                                          type="button"
                                        >
                                          Retry
                                        </button>
                                      </span>
                                    ) : (
                                      <>
                                        <span>{message.readAt ? "Seen" : "Sent"}</span>
                                        {message.readAt ? (
                                          <CheckCheck size={15} className="text-[#00a884]" />
                                        ) : selectedChat?.online ? (
                                          <CheckCheck size={15} className="text-[#94a3b8]" />
                                        ) : (
                                          <Check size={15} className="text-[#94a3b8]" />
                                        )}
                                      </>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          )}
                          <MessageReactions align={message.mine ? "right" : "left"} onReact={reactToMessage} onShowDetails={setReactionDetails} pickerTarget={reactionPicker} reactions={message.reactions} setPickerTarget={setReactionPicker} target={{ type: "direct", messageId: message.id }} />
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

              <footer className={`fixed bottom-0 left-0 right-0 z-40 border-t border-[#e5e9f0] bg-white px-3 py-3 shadow-[0_-14px_35px_rgba(15,23,42,.08)] sm:px-5 lg:left-[600px] xl:left-[660px] ${isContactInfoOpen ? "lg:right-[360px] xl:right-[380px]" : ""}`}>
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
                {typingUser ? (
                  <div className="mb-2 text-xs font-bold text-[#00a884] cs-fade-up">
                    {typingUser} is typing...
                  </div>
                ) : null}
                {isRecording ? (
                  <div className="flex w-full items-center justify-between rounded-2xl border border-red-200 bg-red-50/50 p-2 shadow-sm focus-within:border-red-400 sm:gap-3">
                    <div className="flex items-center gap-2 px-3 text-sm font-bold text-red-600 animate-pulse">
                      <span className="h-2.5 w-2.5 rounded-full bg-red-600"></span>
                      <span>Recording: {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, "0")}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        aria-label="Cancel recording"
                        className="cs-press rounded-xl px-3 py-2 text-sm font-bold text-[#64748b] hover:bg-white hover:text-[#18212f]"
                        onClick={cancelRecording}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        aria-label="Send voice message"
                        className="cs-press flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-black text-white hover:bg-red-700 shadow-sm"
                        onClick={stopAndSendRecording}
                        type="button"
                      >
                        <span>Send</span>
                        <Send size={15} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex w-full items-center gap-2 rounded-2xl border border-[#dce1e8] bg-[#f8fafc] p-2 shadow-sm focus-within:border-[#00a884] focus-within:bg-white sm:gap-3">
                    <button aria-label="Emoji" className={`cs-press grid h-10 w-10 shrink-0 place-items-center rounded-xl ${isEmojiOpen ? "bg-[#e7f8f2] text-[#00a884]" : "text-[#64748b] hover:bg-white hover:text-[#18212f]"}`} onClick={() => setIsEmojiOpen((open) => !open)} type="button">
                      <Smile size={22} />
                    </button>
                    <button
                      type="button"
                      aria-label="Attach image or video"
                      className="cs-press grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#64748b] hover:bg-white hover:text-[#18212f]"
                      onClick={() => mediaInputRef.current?.click()}
                    >
                      <Image size={22} />
                    </button>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      className="hidden"
                      ref={mediaInputRef}
                      onChange={(e) => {
                        if (e.target.files?.[0]) {
                          handleFileAttachment(e.target.files[0]);
                          e.target.value = "";
                        }
                      }}
                    />
                    <label aria-label="Attach file" className="cs-press grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl text-[#64748b] hover:bg-white hover:text-[#18212f]">
                      <Paperclip size={22} />
                      <input accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.apk" className="hidden" onChange={chooseAttachment} type="file" />
                    </label>
                    <input
                      className="h-11 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm outline-none placeholder:text-[#94a3b8] sm:px-2"
                      onChange={(event) => handleInputChange(event.target.value)}
                      onKeyDown={sendOnEnter}
                      placeholder={selectedChatBlocked ? "Unblock this user to send messages" : "Write a message"}
                      value={currentMessageDraft}
                      disabled={selectedChatBlocked}
                    />
                    {!currentMessageDraft.trim() && !currentAttachmentDraft && !selectedChatBlocked ? (
                      <button
                        aria-label="Record voice message"
                        className="cs-press grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#64748b] hover:bg-white hover:text-[#18212f]"
                        onClick={startRecording}
                        type="button"
                      >
                        <Mic size={22} />
                      </button>
                    ) : null}
                    <button aria-label="Send" className="cs-press flex h-11 shrink-0 items-center gap-2 rounded-xl bg-[#00a884] px-4 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 sm:px-5" disabled={selectedChatBlocked || (!currentMessageDraft.trim() && !currentAttachmentDraft)} onClick={sendChatMessage}>
                      <span className="hidden sm:inline">Send</span>
                      <Send size={18} />
                    </button>
                  </div>
                )}
              </footer>
              </div>
              <ContactInfoPanel
                blocked={selectedChatBlocked}
                chat={selectedChat}
                files={selectedSharedFiles}
                isOpen={isContactInfoOpen}
                links={selectedSharedLinks}
                media={selectedSharedMedia}
                mediaTab={contactInfoMediaTab}
                onBlock={blockCurrentChat}
                onClear={clearCurrentChat}
                onClose={() => { setIsContactInfoOpen(false); setContactInfoMediaTab(null); }}
                onMediaTabChange={setContactInfoMediaTab}
                onReport={reportCurrentChat}
                onSearch={() => { openChatSearchFromContactInfo(); setIsContactInfoOpen(false); }}
                onStartAudio={() => startCall(selectedChat, "audio")}
                onStartVideo={() => startCall(selectedChat, "video")}
                onUnblock={unblockCurrentChat}
              />
            </div>
          ) : mobileTab === "calls" ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <div className="cs-fade-up max-w-lg text-center">
                <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl border border-[#dce1e8] bg-white text-[#00a884] shadow-sm">
                  <Phone size={36} />
                </div>
                <h2 className="mt-6 text-3xl font-black tracking-normal">Start a call</h2>
                <p className="mt-3 text-base leading-7 text-[#64748b]">Select a contact from your call history or chat list to start a voice or video call.</p>
                <div className="mt-8 flex items-center justify-center gap-4">
                  <button
                    className="flex items-center gap-2 rounded-xl bg-[#e7f8f2] px-5 py-3 text-sm font-bold text-[#008f70] transition hover:bg-[#d1f0e5]"
                    onClick={() => { setMobileTab("chats"); }}
                    type="button"
                  >
                    <Phone size={18} />
                    <span>Voice call</span>
                  </button>
                  <button
                    className="flex items-center gap-2 rounded-xl bg-[#e7f8f2] px-5 py-3 text-sm font-bold text-[#008f70] transition hover:bg-[#d1f0e5]"
                    onClick={() => { setMobileTab("chats"); }}
                    type="button"
                  >
                    <Video size={18} />
                    <span>Video call</span>
                  </button>
                </div>
                <p className="mt-10 flex items-center justify-center gap-2 text-xs text-[#94a3b8]">
                  <ShieldCheck size={14} />
                  <span>Your calls are peer-to-peer encrypted</span>
                </p>
              </div>
            </div>
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
      {(!isMobileAIChatOpen && !isMobileDrawerOpen && workspaceMode !== "ai") ? (
        <button
          aria-label="Open AI Assistant"
          className="cs-press fixed bottom-[5.5rem] right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#7c3aed] to-[#3b82f6] text-white shadow-[0_12px_32px_rgba(124,58,237,.45)] transition hover:scale-105 hover:shadow-[0_16px_40px_rgba(124,58,237,.55)] lg:hidden sm:right-6"
          onClick={() => setIsMobileAIChatOpen(true)}
          type="button"
        >
          <Bot size={26} />
        </button>
      ) : null}

      {/* Mobile bottom navigation */}
      {!selectedChat && !selectedGroupId && !isMobileAIChatOpen && workspaceMode !== "ai" ? (
        <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-[#e5e9f0] bg-white lg:hidden">
          {([
            { key: "chats" as const, label: "Chats", icon: MessageCircle },
            { key: "status" as const, label: "Status", icon: Radio },
            { key: "groups" as const, label: "Groups", icon: Users },
            { key: "calls" as const, label: "Calls", icon: Phone },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-xs font-semibold transition-colors ${
                mobileTab === key
                  ? "text-[#00a884]"
                  : "text-[#94a3b8] hover:text-[#64748b]"
              }`}
              onClick={() => setMobileTab(key)}
              type="button"
            >
              <Icon size={22} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      ) : null}

      {/* Mobile placeholder screens for non-chats tabs */}
      {!selectedChat && !selectedGroupId && mobileTab !== "chats" && workspaceMode !== "ai" ? (
        mobileTab === "calls" ? (
          <div className="fixed inset-0 top-16 bottom-16 z-30 flex flex-col bg-white lg:hidden">
            <div className="border-b border-[#e5e9f0] px-4 py-3">
              <h2 className="text-lg font-black">Calls</h2>
              <label className="mt-2 flex h-10 items-center gap-3 rounded-xl border border-[#dce1e8] bg-[#f7f9fb] px-3 text-[#64748b]">
                <Search size={17} />
                <input
                  className="w-full bg-transparent text-sm outline-none placeholder:text-[#94a3b8]"
                  onChange={(e) => setCallHistorySearch(e.target.value)}
                  placeholder="Search calls"
                  value={callHistorySearch}
                />
              </label>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <div className="mb-2 px-2 text-xs font-bold text-[#94a3b8]">Recent</div>
              {isCallHistoryLoading ? (
                <div className="space-y-3">
                  {[1,2,3].map(i => (
                    <div key={i} className="flex items-center gap-3 rounded-2xl p-3">
                      <div className="cs-skeleton h-11 w-11 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <div className="cs-skeleton h-4 w-28" />
                        <div className="cs-skeleton h-3 w-20" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : callHistory.filter(c => !callHistorySearch.trim() || c.otherUser.name.toLowerCase().includes(callHistorySearch.toLowerCase())).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="grid h-16 w-16 place-items-center rounded-full bg-[#f7f9fb] text-[#94a3b8]">
                    <Phone size={28} />
                  </div>
                  <p className="mt-4 text-sm font-bold text-[#18212f]">{callHistorySearch.trim() ? "No matching calls" : "No calls yet"}</p>
                  <p className="mt-1 text-xs text-[#94a3b8]">{callHistorySearch.trim() ? "Try a different name." : "Start a conversation and make a call."}</p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {callHistory
                    .filter(c => !callHistorySearch.trim() || c.otherUser.name.toLowerCase().includes(callHistorySearch.toLowerCase()))
                    .map(call => {
                      const isMissed = call.status === "missed" || call.status === "rejected";
                      const directionIcon = call.direction === "outgoing" ? "↗" : "↙";
                      return (
                        <div key={call.id} className="flex items-center gap-3 rounded-2xl p-3">
                          <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-[#e7f8f2] text-xs font-black text-[#008f70]">
                            {call.otherUser.avatarUrl ? (
                              <AvatarImage alt={call.otherUser.name} className="h-full w-full object-cover" fallback={chatInitials(call.otherUser.name)} src={call.otherUser.avatarUrl} />
                            ) : (
                              chatInitials(call.otherUser.name)
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className={`truncate text-sm font-bold ${isMissed ? "text-[#ef4444]" : "text-[#18212f]"}`}>{call.otherUser.name}</div>
                            <div className={`mt-0.5 flex items-center gap-1 text-xs ${isMissed ? "text-[#ef4444]" : "text-[#64748b]"}`}>
                              <span>{directionIcon}</span>
                              {call.callType === "video" ? <Video size={11} /> : <Phone size={11} />}
                              <span>·</span>
                              {call.status === "ended" && call.durationSeconds > 0 ? (
                                <span>{formatCallDuration(call.durationSeconds)}</span>
                              ) : (
                                <span className="capitalize">{call.status}</span>
                              )}
                              <span>·</span>
                              <span>{formatCallTime(call.startedAt)}</span>
                            </div>
                          </div>
                          <button
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#00a884] hover:bg-[#e7f8f2] transition"
                            onClick={() => {
                              const chatSeed = directoryChats.find(c => c.id === call.otherUser.id);
                              if (chatSeed) startCall(chatSeed, call.callType);
                            }}
                            type="button"
                          >
                            {call.callType === "video" ? <Video size={18} /> : <Phone size={18} />}
                          </button>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        ) : mobileTab === "groups" ? (
          <GroupListPanel
            authToken={authToken}
            currentUserId={currentUserId}
            groups={groups}
            users={directoryChats}
            isLoading={isGroupsLoading}
            error={groupsError}
            onSelect={selectGroup}
            onRefresh={fetchGroups}
            className="fixed inset-0 top-16 bottom-16 z-30 flex lg:hidden"
          />
        ) : mobileTab === "status" ? (
          <StatusPanel
            authToken={authToken}
            currentUserId={currentUserId}
            currentUser={{ name: `${firstName} ${lastName}`.trim() || "You", avatarUrl: avatarPreview }}
            className="fixed inset-0 top-16 bottom-16 z-30 flex lg:hidden"
          />
        ) : (
          <div className="fixed inset-0 top-16 bottom-16 z-30 flex flex-col items-center justify-center bg-white px-6 lg:hidden">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl border border-[#dce1e8] bg-[#f7f9fb] text-[#94a3b8]">
              <Users size={36} />
            </div>
            <h2 className="mt-6 text-2xl font-black tracking-normal text-[#18212f]">
              Groups
            </h2>
            <p className="mt-3 text-center text-base leading-7 text-[#64748b]">
              Group conversations will appear here.
            </p>
          </div>
        )
      ) : null}

      {/* Mobile & tablet AI chat overlay */}
      {isMobileAIChatOpen ? (
        <div className="cs-scale-in fixed inset-0 z-[60] flex flex-col bg-[#f7f9fb] lg:hidden">
          <AIChat
            apiUrl={apiUrl()}
            authToken={authToken}
            onClose={() => setIsMobileAIChatOpen(false)}
            messages={aiMessages}
            setMessages={setAiMessages}
            input={aiInput}
            setInput={setAiInput}
            isLoading={isAiLoading}
            setIsLoading={setIsAiLoading}
            error={aiError}
            setError={setAiError}
          />
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

            <AvatarSelection
              currentPreview={avatarPreview}
              fallback={userInitials}
              inputId="profile-editor-avatar-upload"
              labelTone="light"
              onChooseBuiltIn={chooseBuiltInAvatar}
              onChooseGallery={chooseAvatar}
              selectedBuiltInAvatar={selectedBuiltInAvatar}
              title="Choose your profile picture"
            />

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

      {reactionDetails ? (
        <div className="fixed inset-0 z-[75] grid place-items-center bg-[#0f172a]/35 px-4" onClick={() => setReactionDetails(null)}>
          <div className="cs-scale-in w-full max-w-xs rounded-2xl border border-[#dce1e8] bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-3xl">{reactionDetails.emoji}</div>
                <h2 className="mt-2 text-base font-black">Reacted</h2>
              </div>
              <button aria-label="Close reactions" className="grid h-9 w-9 place-items-center rounded-lg text-[#64748b] hover:bg-[#f8fafc]" onClick={() => setReactionDetails(null)} type="button"><X size={18} /></button>
            </div>
            <div className="mt-4 space-y-2">
              {reactionDetails.users.length ? reactionDetails.users.map((user) => (
                <div className="rounded-xl bg-[#f8fafc] px-3 py-2 text-sm font-bold text-[#334155]" key={user.id}>{user.name}</div>
              )) : <p className="text-sm font-semibold text-[#64748b]">No reactions yet.</p>}
            </div>
          </div>
        </div>
      ) : null}

      <AudioCallOverlay
        callState={callState}
        remoteUser={remoteUser}
        isMuted={isMuted}
        callDuration={callDuration}
        callType={callType}
        isCameraOn={isCameraOn}
        isRemoteCameraOn={isRemoteCameraOn}
        localStream={localStream}
        remoteStream={remoteStream}
        facingMode={facingMode}
        acceptCall={acceptCall}
        rejectCall={rejectCall}
        endCall={endCall}
        toggleMute={toggleMute}
        toggleCamera={toggleCamera}
        switchCamera={switchCamera}
        directoryChats={directoryChats}
        inviteParticipant={inviteParticipant}
        participants={participants}
        remoteStreams={remoteStreams}
        participantsCameraOn={participantsCameraOn}
        participantsMuted={participantsMuted}
      />
    </main>
  );
}

const formatMessageTime = (message: ChatMessage | undefined) => {
  if (!message) return "";

  if (message.createdAt) {
    const date = new Date(message.createdAt);

    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
    }
  }

  return message.time;
};

function formatLastSeen(lastSeenAt?: string): string {
  if (!lastSeenAt) return "Offline";
  const date = new Date(lastSeenAt);
  if (Number.isNaN(date.getTime())) return "Offline";

  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "Last seen just now";
  if (diffMinutes < 60) return `Last seen ${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 6) return `Last seen ${diffHours} ${diffHours === 1 ? "hour" : "hours"} ago`;

  const sameDay = now.toDateString() === date.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Last seen today at ${time}`;
  if (yesterday.toDateString() === date.toDateString()) return `Last seen yesterday at ${time}`;
  return `Last seen ${date.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time}`;
}

function attachmentPreviewLabel(message: ChatMessage | undefined): string {
  const body = message?.body?.trim();
  if (body) return body;
  const attachment = message?.attachment;
  if (!attachment) return "";
  if (attachment.kind === "image" || attachment.type.toLowerCase().startsWith("image/")) return "Photo";
  if (attachment.kind === "video" || attachment.type.toLowerCase().startsWith("video/")) return "Video";
  if (attachment.kind === "audio" || attachment.type.toLowerCase().startsWith("audio/")) return "Voice message";
  return "File";
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

function formatGroupTime(dateStr: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString() === new Date().toLocaleDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function statusRelativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return "Yesterday";
}

function StatusAvatar({ user, ring = "none", size = "h-14 w-14" }: { user: { name: string; avatarUrl?: string }; ring?: "unseen" | "viewed" | "none"; size?: string }) {
  return (
    <div className={`${size} shrink-0 rounded-full p-[2px] ${ring === "unseen" ? "bg-[#00a884]" : ring === "viewed" ? "bg-[#cbd5e1]" : "bg-transparent"}`}>
      <div className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-[#e7f8f2] text-sm font-black text-[#008f70]">
        {user.avatarUrl ? <AvatarImage alt={user.name} className="h-full w-full object-cover" fallback={chatInitials(user.name)} src={user.avatarUrl} /> : chatInitials(user.name)}
      </div>
    </div>
  );
}

function StatusPanel({ authToken, currentUserId, currentUser, className = "" }: StatusPanelProps) {
  const [statuses, setStatuses] = useState<StatusEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [composerType, setComposerType] = useState<"text" | "image" | "video">("text");
  const [composerText, setComposerText] = useState("");
  const [composerCaption, setComposerCaption] = useState("");
  const [composerBackground, setComposerBackground] = useState("#e7f8f2");
  const [composerFile, setComposerFile] = useState<File | null>(null);
  const [composerPreview, setComposerPreview] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [viewer, setViewer] = useState<{ group: StatusEntry[]; index: number } | null>(null);
  const [viewerPaused, setViewerPaused] = useState(false);
  const [viewerProgress, setViewerProgress] = useState(0);
  const [viewerDuration, setViewerDuration] = useState<number | null>(null);
  const [viewerList, setViewerList] = useState<{ user: { name: string; avatarUrl?: string }; viewedAt: string }[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const viewerAnimationFrameRef = useRef<number | null>(null);
  const viewerProgressRef = useRef(0);

  const loadStatuses = useCallback(async () => {
    if (!authToken) return;
    setIsLoading(true);
    try {
      const response = await fetch(`${apiUrl()}/api/v1/statuses?limit=200`, { headers: authHeaders(authToken) });
      if (!response.ok) throw new Error("Could not load statuses");
      const data = await response.json();
      setStatuses(Array.isArray(data.statuses) ? data.statuses : []);
      setError("");
    } catch (loadError) {
      console.error("Failed to fetch statuses", loadError);
      setError("Could not load status updates.");
    } finally {
      setIsLoading(false);
    }
  }, [authToken]);

  useEffect(() => { loadStatuses(); }, [loadStatuses]);

  const groups = useMemo(() => {
    const grouped = new Map<string, StatusEntry[]>();
    statuses.forEach((status) => grouped.set(status.userId, [...(grouped.get(status.userId) ?? []), status]));
    return Array.from(grouped.values()).sort((a, b) => Date.parse(b[0].createdAt) - Date.parse(a[0].createdAt));
  }, [statuses]);
  const myStatuses = groups.find((group) => group[0]?.userId === currentUserId) ?? [];
  const otherGroups = groups.filter((group) => group[0]?.userId !== currentUserId);
  const recentGroups = otherGroups.filter((group) => group.some((status) => !status.viewed));
  const viewedGroups = otherGroups.filter((group) => group.every((status) => status.viewed));
  const currentStatus = viewer ? viewer.group[viewer.index] : null;

  useEffect(() => {
    if (!currentStatus || currentStatus.userId === currentUserId) return;
    fetch(`${apiUrl()}/api/v1/statuses/${currentStatus.id}/view`, { method: "POST", headers: authHeaders(authToken) }).catch(() => undefined);
    setStatuses((existing) => existing.map((status) => status.id === currentStatus.id ? { ...status, viewed: true } : status));
  }, [authToken, currentStatus, currentUserId]);

  const advanceViewer = useCallback(() => {
    setViewer((current) => {
      if (!current || current.index >= current.group.length - 1) return null;
      return { ...current, index: current.index + 1 };
    });
  }, []);

  useEffect(() => {
    viewerProgressRef.current = 0;
    setViewerProgress(0);
    setViewerDuration(currentStatus?.type === "video" ? null : currentStatus ? 5000 : null);
  }, [currentStatus?.id]);

  useEffect(() => {
    if (viewerAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(viewerAnimationFrameRef.current);
      viewerAnimationFrameRef.current = null;
    }
    if (!currentStatus || viewerPaused || viewerDuration === null) return;

    const duration = viewerDuration;
    const start = performance.now() - viewerProgressRef.current * duration;
    const animate = (now: number) => {
      const nextProgress = Math.min(1, (now - start) / duration);
      viewerProgressRef.current = nextProgress;
      setViewerProgress(nextProgress);
      if (nextProgress >= 1) {
        viewerAnimationFrameRef.current = null;
        advanceViewer();
        return;
      }
      viewerAnimationFrameRef.current = window.requestAnimationFrame(animate);
    };
    viewerAnimationFrameRef.current = window.requestAnimationFrame(animate);
    return () => {
      if (viewerAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(viewerAnimationFrameRef.current);
        viewerAnimationFrameRef.current = null;
      }
    };
  }, [advanceViewer, currentStatus?.id, viewerDuration, viewerPaused]);

  useEffect(() => () => {
    if (viewerAnimationFrameRef.current !== null) window.cancelAnimationFrame(viewerAnimationFrameRef.current);
  }, []);

  const closeComposer = () => {
    setIsComposerOpen(false); setComposerFile(null); setComposerPreview(""); setComposerText(""); setComposerCaption("");
  };
  const chooseStatusFile = (file: File | undefined) => {
    if (!file || (!file.type.startsWith("image/") && !file.type.startsWith("video/"))) return;
    setComposerType(file.type.startsWith("video/") ? "video" : "image");
    setComposerFile(file); setComposerPreview(URL.createObjectURL(file));
  };
  const postStatus = async (event: FormEvent) => {
    event.preventDefault();
    if (composerType === "text" && !composerText.trim()) return;
    if (composerType !== "text" && !composerFile) return;
    setIsPosting(true); setError("");
    try {
      let mediaUrl = "";
      if (composerFile) {
        const form = new FormData(); form.append("file", composerFile);
        const upload = await fetch(`${apiUrl()}/api/v1/upload`, { method: "POST", headers: authHeaders(authToken), body: form });
        const uploadData = await upload.json();
        if (!upload.ok || !uploadData.url) throw new Error(uploadData.error || "Could not upload status media");
        mediaUrl = uploadData.url;
      }
      const response = await fetch(`${apiUrl()}/api/v1/statuses`, {
        method: "POST", headers: { ...authHeaders(authToken), "Content-Type": "application/json" },
        body: JSON.stringify({ type: composerType, textContent: composerText, mediaUrl, caption: composerCaption, background: composerBackground })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not publish status");
      closeComposer(); await loadStatuses();
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "Could not publish status.");
    } finally { setIsPosting(false); }
  };
  const deleteStatus = async (status: StatusEntry) => {
    if (!window.confirm("Delete this status update?")) return;
    const response = await fetch(`${apiUrl()}/api/v1/statuses/${status.id}`, { method: "DELETE", headers: authHeaders(authToken) });
    if (response.ok) { setViewer((current) => current && current.group.length === 1 ? null : current); await loadStatuses(); }
  };
  const showViewers = async (status: StatusEntry) => {
    const response = await fetch(`${apiUrl()}/api/v1/statuses/${status.id}/viewers`, { headers: authHeaders(authToken) });
    if (response.ok) { const data = await response.json(); setViewerList(data.viewers ?? []); }
  };
  const openGroup = (group: StatusEntry[]) => setViewer({ group, index: Math.max(0, group.findIndex((status) => !status.viewed)) });
  const goViewer = (delta: number) => setViewer((current) => {
    if (!current) return null;
    const next = current.index + delta;
    return next < 0 || next >= current.group.length ? current : { ...current, index: next };
  });
  const handleViewerVideoMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const duration = event.currentTarget.duration;
    if (Number.isFinite(duration) && duration > 0) setViewerDuration(duration * 1000);
  };

  const renderGroup = (group: StatusEntry[], compact = false) => {
    const first = group[0];
    const unseen = group.some((status) => !status.viewed);
    const mediaSource = first.type === "image" || first.type === "video" ? attachmentSource(first.mediaUrl || "", authToken) : "";
    return (
      <button className={compact
        ? "flex w-[76px] shrink-0 flex-col items-center gap-2 text-center"
        : "flex h-auto w-[76px] shrink-0 flex-col items-center gap-2 text-center lg:relative lg:h-[230px] lg:w-[132px] lg:overflow-hidden lg:rounded-2xl lg:border lg:border-[#dce1e8] lg:bg-[#e7f8f2] lg:text-left lg:shadow-sm lg:transition lg:hover:-translate-y-0.5 lg:hover:shadow-md"}
        key={first.userId} onClick={() => openGroup(group)} type="button">
        {compact ? (
          <>
            <StatusAvatar ring={unseen ? "unseen" : "viewed"} size="h-[72px] w-[72px]" user={first.user} />
            <span className="w-full truncate text-xs font-bold text-[#334155]">{first.user.name}</span>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-2 lg:hidden">
              <StatusAvatar ring={unseen ? "unseen" : "viewed"} size="h-[72px] w-[72px]" user={first.user} />
              <span className="w-full truncate text-xs font-bold text-[#334155]">{first.user.name}</span>
            </div>
            <div className="relative hidden h-full flex-col items-center justify-between p-3 lg:flex">
              {mediaSource ? (
                first.type === "video" ? <video aria-hidden className="absolute inset-0 h-full w-full object-cover" muted playsInline preload="metadata" src={mediaSource} /> : <img alt="" className="absolute inset-0 h-full w-full object-cover" src={mediaSource} />
              ) : <div className="absolute inset-0" style={{ backgroundColor: first.background || "#e7f8f2" }} />}
              <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/75" />
              <div className="relative flex h-full w-full flex-col items-center justify-between">
                <StatusAvatar ring={unseen ? "unseen" : "viewed"} size="h-11 w-11" user={first.user} />
                <span className="w-full truncate text-center text-sm font-black text-white">{first.user.name}</span>
              </div>
            </div>
          </>
        )}
      </button>
    );
  };

  return (
    <div className={`${className} min-h-0 flex-1 flex-col bg-white`}>
      <header className="flex items-center justify-between border-b border-[#e5e9f0] px-5 py-4">
        <div><p className="text-xs font-black uppercase tracking-[0.22em] text-[#00a884]">Updates</p><h1 className="mt-1 text-2xl font-black text-[#18212f]">Status</h1></div>
        <button aria-label="Add status update" className="grid h-10 w-10 place-items-center rounded-xl bg-[#e7f8f2] text-[#008f70] transition hover:bg-[#d1f0e5]" onClick={() => setIsComposerOpen(true)} title="Add status update" type="button"><Plus size={20} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-[#e5e9f0] px-4 py-4">
          <div className="flex items-center gap-3">
            <button aria-label={myStatuses.length ? "Open my status" : "Add status update"} onClick={() => myStatuses.length ? openGroup(myStatuses) : setIsComposerOpen(true)} type="button"><StatusAvatar ring={myStatuses.length ? "unseen" : "none"} user={currentUser} size="h-14 w-14" /></button>
            <button className="min-w-0 flex-1 text-left" onClick={() => myStatuses.length ? openGroup(myStatuses) : setIsComposerOpen(true)} type="button"><strong className="block text-sm font-black text-[#18212f]">{myStatuses.length ? "My status" : "Add status update"}</strong><span className="mt-1 block text-xs text-[#64748b]">{myStatuses.length ? `${myStatuses.length} active update${myStatuses.length === 1 ? "" : "s"}` : "Share with your contacts"}</span></button>
            <button aria-label="Create status" className="grid h-10 w-10 place-items-center rounded-xl text-[#00a884] hover:bg-[#e7f8f2]" onClick={() => setIsComposerOpen(true)} type="button"><Camera size={20} /></button>
          </div>
          {myStatuses.length ? <button className="mt-3 text-xs font-black text-[#008f70]" onClick={() => setIsComposerOpen(true)} type="button">Add another update</button> : null}
        </section>
        {error ? <div className="mx-4 mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div> : null}
        {isLoading ? <div className="space-y-3 px-4 py-5">{[1, 2, 3].map((item) => <div className="flex items-center gap-3" key={item}><div className="cs-skeleton h-14 w-14 rounded-full" /><div className="cs-skeleton h-4 w-40" /></div>)}</div> : null}
        {!isLoading && recentGroups.length ? <section><h2 className="px-4 pb-3 pt-5 text-xs font-black uppercase tracking-[0.16em] text-[#64748b]">Recent updates</h2><div className="flex gap-3 overflow-x-auto px-4 pb-4">{recentGroups.map((group) => renderGroup(group))}</div></section> : null}
        {!isLoading && viewedGroups.length ? <section><h2 className="px-4 pb-3 pt-5 text-xs font-black uppercase tracking-[0.16em] text-[#64748b]">Viewed updates</h2><div className="flex gap-4 overflow-x-auto px-4 pb-4">{viewedGroups.map((group) => renderGroup(group, true))}</div></section> : null}
        {!isLoading && !recentGroups.length && !viewedGroups.length ? <div className="px-6 py-16 text-center"><Radio className="mx-auto text-[#00a884]" size={32} /><h2 className="mt-4 text-base font-black text-[#18212f]">No recent updates</h2><p className="mt-2 text-sm leading-6 text-[#64748b]">Share a photo, video, or thought with your contacts.</p></div> : null}
      </div>

      {isComposerOpen ? <div className="fixed inset-0 z-[70] grid place-items-center bg-[#0f172a]/50 px-4"><form className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onSubmit={postStatus}>
        <div className="flex items-start justify-between"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-[#00a884]">New update</p><h2 className="mt-1 text-xl font-black">Create status</h2></div><button aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-[#64748b] hover:bg-[#f8fafc]" onClick={closeComposer} type="button"><X size={18} /></button></div>
        <div className="mt-5 grid grid-cols-3 gap-2"><button className={`rounded-xl border px-3 py-2 text-sm font-black ${composerType === "text" ? "border-[#00a884] bg-[#e7f8f2] text-[#008f70]" : "border-[#dce1e8] text-[#64748b]"}`} onClick={() => { setComposerType("text"); setComposerFile(null); setComposerPreview(""); }} type="button">Text</button><button className={`rounded-xl border px-3 py-2 text-sm font-black ${composerType === "image" ? "border-[#00a884] bg-[#e7f8f2] text-[#008f70]" : "border-[#dce1e8] text-[#64748b]"}`} onClick={() => { setComposerType("image"); fileInputRef.current?.click(); }} type="button">Image</button><button className={`rounded-xl border px-3 py-2 text-sm font-black ${composerType === "video" ? "border-[#00a884] bg-[#e7f8f2] text-[#008f70]" : "border-[#dce1e8] text-[#64748b]"}`} onClick={() => { setComposerType("video"); fileInputRef.current?.click(); }} type="button">Video</button></div>
        <input className="hidden" accept="image/*,video/*" onChange={(event) => chooseStatusFile(event.target.files?.[0])} ref={fileInputRef} type="file" />
        {composerType === "text" ? <><textarea autoFocus className="mt-4 min-h-36 w-full resize-none rounded-xl border border-[#dce1e8] bg-[#f8fafc] p-4 text-base outline-none focus:border-[#00a884]" maxLength={2000} onChange={(event) => setComposerText(event.target.value)} placeholder="Share an update..." value={composerText} /><div className="mt-3 flex gap-2">{["#e7f8f2", "#dbeafe", "#fef3c7", "#fce7f3", "#e2e8f0"].map((color) => <button aria-label={`Use ${color} background`} className={`h-8 w-8 rounded-full border-2 ${composerBackground === color ? "border-[#18212f]" : "border-white shadow"}`} key={color} onClick={() => setComposerBackground(color)} style={{ backgroundColor: color }} type="button" />)}</div></> : <>{composerPreview ? <div className="mt-4 overflow-hidden rounded-xl bg-[#f8fafc]">{composerType === "video" ? <video className="max-h-72 w-full object-contain" controls src={composerPreview} /> : <img alt="Status preview" className="max-h-72 w-full object-contain" src={composerPreview} />}</div> : <button className="mt-4 flex h-32 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#cbd5e1] text-sm font-black text-[#64748b]" onClick={() => fileInputRef.current?.click()} type="button"><Image size={22} />Choose media</button>}<input className="mt-3 h-11 w-full rounded-xl border border-[#dce1e8] px-3 text-sm outline-none focus:border-[#00a884]" maxLength={500} onChange={(event) => setComposerCaption(event.target.value)} placeholder="Add a caption (optional)" value={composerCaption} /></>}
        <button className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#00a884] text-sm font-black text-white disabled:opacity-50" disabled={isPosting || (composerType === "text" ? !composerText.trim() : !composerFile)} type="submit">{isPosting ? "Posting..." : "Share status"}<Send size={16} /></button>
      </form></div> : null}

      {viewer && currentStatus ? <div className="fixed inset-0 z-[80] flex flex-col bg-[#07130f] text-white" onPointerCancel={() => setViewerPaused(false)} onPointerDown={() => setViewerPaused(true)} onPointerUp={() => setViewerPaused(false)}>
        <div className="flex gap-1 px-4 pt-3">{viewer.group.map((status, index) => <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/30" key={status.id}><div className="h-full bg-white" style={{ width: index < viewer.index ? "100%" : index === viewer.index ? `${viewerProgress * 100}%` : "0%", transition: "width 50ms linear" }} /></div>)}</div>
        <div className="flex items-center gap-3 px-4 py-4"><StatusAvatar ring="none" size="h-10 w-10" user={currentStatus.user} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-black">{currentStatus.user.name}</div><div className="text-xs text-white/70">{statusRelativeTime(currentStatus.createdAt)}</div></div>{currentStatus.userId === currentUserId ? <><button aria-label="Show viewers" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10" onClick={() => showViewers(currentStatus)} type="button"><Eye size={18} /></button><button aria-label="Delete status" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10" onClick={() => deleteStatus(currentStatus)} type="button"><Trash2 size={18} /></button></> : null}<button aria-label="Close status viewer" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10" onClick={() => setViewer(null)} type="button"><X size={20} /></button></div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center px-8"><button aria-label="Previous status" className="absolute left-2 z-10 grid h-12 w-12 place-items-center rounded-full hover:bg-white/10 disabled:opacity-20" disabled={viewer.index === 0} onClick={() => goViewer(-1)} type="button"><ChevronLeft size={30} /></button><div className="max-h-full max-w-2xl text-center">{currentStatus.type === "text" ? <div className="flex min-h-[45vh] min-w-[min(80vw,34rem)] items-center justify-center rounded-2xl p-10 text-2xl font-black" style={{ backgroundColor: currentStatus.background || "#e7f8f2", color: "#18212f" }}>{currentStatus.textContent}</div> : currentStatus.type === "video" ? <video autoPlay className="max-h-[68vh] max-w-full rounded-2xl" controls onLoadedMetadata={handleViewerVideoMetadata} src={attachmentSource(currentStatus.mediaUrl || "", authToken)} /> : <img alt={currentStatus.caption || "Status update"} className="max-h-[68vh] max-w-full rounded-2xl object-contain" src={attachmentSource(currentStatus.mediaUrl || "", authToken)} />}{currentStatus.caption ? <p className="mt-4 text-sm text-white/90">{currentStatus.caption}</p> : null}</div><button aria-label="Next status" className="absolute right-2 grid h-12 w-12 place-items-center rounded-full hover:bg-white/10 disabled:opacity-20" disabled={viewer.index === viewer.group.length - 1} onClick={() => goViewer(1)} type="button"><ChevronRight size={30} /></button></div>
        {viewerList ? <div className="absolute bottom-4 left-1/2 max-h-48 w-[min(90vw,24rem)] -translate-x-1/2 overflow-y-auto rounded-xl bg-white p-3 text-[#18212f] shadow-xl"><div className="mb-2 flex items-center justify-between text-sm font-black">Viewed by <button aria-label="Close viewer list" onClick={() => setViewerList(null)} type="button"><X size={16} /></button></div>{viewerList.length ? viewerList.map((item) => <div className="flex items-center gap-2 border-t border-[#edf1f5] py-2" key={`${item.user.name}-${item.viewedAt}`}><StatusAvatar size="h-7 w-7" user={item.user} /><span className="text-xs font-bold">{item.user.name}</span></div>) : <p className="text-xs text-[#64748b]">No views yet.</p>}</div> : null}
      </div> : null}
    </div>
  );
}

type GroupListPanelProps = {
  authToken: string;
  currentUserId: string;
  groups: GroupSummary[];
  users: ChatSeed[];
  isLoading: boolean;
  error: string;
  className?: string;
  onSelect: (groupId: string) => void;
  onRefresh: () => Promise<void>;
};

function GroupAvatar({ name, avatarUrl, className = "h-12 w-12" }: { name: string; avatarUrl?: string; className?: string }) {
  return <div className={`${className} grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#e7f8f2] text-sm font-black text-[#008f70]`}>{avatarUrl ? <AvatarImage alt={name} className="h-full w-full object-cover" fallback={chatInitials(name)} src={avatarUrl} /> : chatInitials(name)}</div>;
}

function GroupListPanel({ authToken, currentUserId, groups, users, isLoading, error, className = "", onSelect, onRefresh }: GroupListPanelProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const availableUsers = users.filter((user) => user.id !== currentUserId && `${user.name} ${user.preview}`.toLowerCase().includes(search.trim().toLowerCase()));
  const resetCreate = () => { setIsCreateOpen(false); setName(""); setSearch(""); setSelectedMembers([]); setAvatarFile(null); setAvatarPreview(""); setCreateError(""); };
  const createGroup = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !selectedMembers.length) { setCreateError("Add at least one member and a group name."); return; }
    setIsCreating(true); setCreateError("");
    try {
      let avatarUrl = "";
      if (avatarFile) {
        const form = new FormData(); form.append("file", avatarFile);
        const upload = await fetch(`${apiUrl()}/api/v1/upload`, { method: "POST", headers: authHeaders(authToken), body: form });
        const uploadData = await upload.json();
        if (!upload.ok || !uploadData.url) throw new Error(uploadData.error || "Could not upload group avatar");
        avatarUrl = uploadData.url;
      }
      const response = await fetch(`${apiUrl()}/api/v1/groups`, { method: "POST", headers: { ...authHeaders(authToken), "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), avatarUrl, memberIds: selectedMembers }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create group");
      resetCreate(); await onRefresh(); onSelect(data.group?.id);
    } catch (error) { setCreateError(error instanceof Error ? error.message : "Could not create group"); } finally { setIsCreating(false); }
  };

  return <div className={`${className} min-h-0 flex-1 flex-col bg-white`}>
    <header className="flex items-center justify-between border-b border-[#e5e9f0] px-5 py-4"><div><p className="text-xs font-black uppercase tracking-[0.22em] text-[#00a884]">Community</p><h1 className="mt-1 text-2xl font-black">Groups</h1></div><button aria-label="Create group" className="grid h-10 w-10 place-items-center rounded-xl bg-[#e7f8f2] text-[#008f70] hover:bg-[#d1f0e5]" onClick={() => setIsCreateOpen(true)} title="Create group" type="button"><Plus size={20} /></button></header>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
      {error ? <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div> : null}
      {isLoading ? <div className="space-y-3">{[1, 2, 3].map((item) => <div className="flex items-center gap-3 p-3" key={item}><div className="cs-skeleton h-12 w-12 rounded-2xl" /><div className="cs-skeleton h-4 w-36" /></div>)}</div> : groups.length ? groups.map((group) => <button className="flex w-full items-center gap-3 rounded-2xl p-3 text-left transition hover:bg-[#f8fafc]" key={group.id} onClick={() => onSelect(group.id)} type="button"><GroupAvatar avatarUrl={group.avatarUrl} name={group.name} /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><strong className="truncate text-sm font-black">{group.name}</strong><span className="text-[11px] font-bold text-[#94a3b8]">{group.latestMessage?.createdAt ? formatGroupTime(group.latestMessage.createdAt) : "new"}</span></span><span className="mt-1 block truncate text-sm text-[#64748b]">{group.latestMessage?.body || group.latestMessage?.attachment?.name || `${group.memberCount} members`}</span></span></button>) : <div className="mt-16 rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-5 py-10 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#e7f8f2] text-[#00a884]"><Users size={24} /></div><h2 className="mt-5 text-base font-black">No groups yet</h2><p className="mt-2 text-sm leading-6 text-[#64748b]">Create a group and start chatting with multiple people.</p><button className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#00a884] px-4 py-2.5 text-sm font-black text-white" onClick={() => setIsCreateOpen(true)} type="button"><Plus size={16} />Create Group</button></div>}
    </div>
    {isCreateOpen ? <div className="fixed inset-0 z-[70] grid place-items-center bg-[#0f172a]/45 px-4"><form className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onSubmit={createGroup}><div className="flex items-start justify-between"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-[#00a884]">New group</p><h2 className="mt-1 text-xl font-black">Create Group</h2></div><button aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-[#64748b] hover:bg-[#f8fafc]" onClick={resetCreate} type="button"><X size={18} /></button></div><label className="mt-5 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[#cbd5e1] p-3"><div className="grid h-12 w-12 place-items-center overflow-hidden rounded-xl bg-[#e7f8f2] text-[#008f70]">{avatarPreview ? <img alt="Group avatar preview" className="h-full w-full object-cover" src={avatarPreview} /> : <Upload size={20} />}</div><span className="text-sm font-bold text-[#64748b]">Add group photo (optional)</span><input accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setAvatarFile(file); setAvatarPreview(URL.createObjectURL(file)); } }} type="file" /></label><input autoFocus className="mt-4 h-11 w-full rounded-xl border border-[#dce1e8] px-3 text-sm outline-none focus:border-[#00a884]" onChange={(event) => setName(event.target.value)} placeholder="Group name" value={name} /><div className="mt-5 flex flex-wrap gap-2">{selectedMembers.map((id) => { const user = users.find((item) => item.id === id); return user ? <button className="rounded-full bg-[#e7f8f2] px-3 py-1.5 text-xs font-black text-[#008f70]" key={id} onClick={() => setSelectedMembers((current) => current.filter((item) => item !== id))} type="button">{user.name} <X className="ml-1 inline" size={12} /></button> : null; })}</div><label className="mt-4 flex h-10 items-center gap-2 rounded-xl border border-[#dce1e8] bg-[#f8fafc] px-3 text-[#64748b]"><Search size={16} /><input className="w-full bg-transparent text-sm outline-none" onChange={(event) => setSearch(event.target.value)} placeholder="Search members" value={search} /></label><div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-[#edf1f5]">{availableUsers.map((user) => <button className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-[#f8fafc] ${selectedMembers.includes(user.id) ? "bg-[#effdf8]" : ""}`} key={user.id} onClick={() => setSelectedMembers((current) => current.includes(user.id) ? current.filter((item) => item !== user.id) : [...current, user.id])} type="button"><GroupAvatar avatarUrl={user.avatarUrl} name={user.name} className="h-9 w-9 rounded-xl text-xs" /><span className="min-w-0 flex-1 truncate text-sm font-bold">{user.name}</span>{selectedMembers.includes(user.id) ? <Check size={16} className="text-[#00a884]" /> : null}</button>)}</div>{createError ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{createError}</p> : null}<button className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#00a884] text-sm font-black text-white disabled:opacity-50" disabled={isCreating} type="submit">{isCreating ? "Creating..." : "Create Group"}<Plus size={17} /></button></form></div> : null}
  </div>;
}

type GroupChatPanelProps = {
  authToken: string;
  currentUserId: string;
  currentUserName: string;
  details: GroupDetails | null;
  messages: GroupChatMessage[];
  reactionPicker: ReactionTarget | null;
  setReactionPicker: (target: ReactionTarget | null) => void;
  users: ChatSeed[];
  onBack: () => void;
  onReact: (target: ReactionTarget, emoji: string) => void;
  onReactionDetails: (details: { emoji: string; users: ReactionUser[] }) => void;
  onRefresh: () => Promise<void>;
  onMessage: (message: GroupChatMessage) => void;
  onLeave: () => void;
};

function GroupChatPanel({ authToken, currentUserId, currentUserName, details, messages, reactionPicker, setReactionPicker, users, onBack, onReact, onReactionDetails, onRefresh, onMessage, onLeave }: GroupChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [infoError, setInfoError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const group = details;
  const canManage = group?.role === "owner" || group?.role === "admin";

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages.length]);
  const chooseFile = (next: File | undefined) => { if (!next) return; setFile(next); setFilePreview(next.type.startsWith("image/") ? URL.createObjectURL(next) : ""); };
  const upload = async (next: File) => { const form = new FormData(); form.append("file", next); const response = await fetch(`${apiUrl()}/api/v1/upload`, { method: "POST", headers: authHeaders(authToken), body: form }); const data = await response.json(); if (!response.ok || !data.url) throw new Error(data.error || "Could not upload attachment"); return { name: next.name, type: next.type, kind: next.type.startsWith("image/") ? "image" : next.type.startsWith("video/") ? "video" : next.type.startsWith("audio/") ? "audio" : "file", url: data.url } as NonNullable<ChatMessage["attachment"]>; };
  const send = async (event?: FormEvent) => { event?.preventDefault(); if ((!draft.trim() && !file) || !group || isSending) return; setIsSending(true); try { const attachment = file ? await upload(file) : undefined; const response = await fetch(`${apiUrl()}/api/v1/groups/${group.id}/messages`, { method: "POST", headers: { ...authHeaders(authToken), "Content-Type": "application/json" }, body: JSON.stringify({ body: draft.trim(), attachment }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not send group message"); onMessage({ ...data.message, mine: true }); setDraft(""); setFile(null); setFilePreview(""); } catch (error) { setInfoError(error instanceof Error ? error.message : "Could not send message"); } finally { setIsSending(false); } };
  const startRecording = async () => { if (!navigator.mediaDevices?.getUserMedia) return; const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const recorder = new MediaRecorder(stream); chunksRef.current = []; recorder.ondataavailable = (event) => chunksRef.current.push(event.data); recorder.onstop = () => { stream.getTracks().forEach((track) => track.stop()); const voice = new File([new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })], `voice-${Date.now()}.webm`, { type: recorder.mimeType || "audio/webm" }); setFile(voice); setFilePreview(""); setIsRecording(false); }; recorderRef.current = recorder; recorder.start(); setIsRecording(true); };
  const stopRecording = () => recorderRef.current?.stop();
  const manage = async (method: string, path: string, body?: unknown) => { if (!group) return; setInfoError(""); const response = await fetch(`${apiUrl()}/api/v1/groups/${group.id}${path}`, { method, headers: body ? { ...authHeaders(authToken), "Content-Type": "application/json" } : authHeaders(authToken), body: body ? JSON.stringify(body) : undefined }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Group action failed"); await onRefresh(); };

  if (!group) return <div className="flex flex-1 items-center justify-center text-sm font-bold text-[#64748b]"><Loader2 className="mr-2 animate-spin" size={18} />Loading group...</div>;
  return <div className="flex min-h-0 flex-1 flex-col bg-[#f7f9fb]"><header className="flex min-h-[82px] items-center gap-3 border-b border-[#e5e9f0] bg-white px-4 sm:px-6"><button aria-label="Back to groups" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#64748b] hover:bg-[#f1f5f9] lg:hidden" onClick={onBack} type="button"><ArrowLeft size={22} /></button><button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setIsInfoOpen(true)} type="button"><GroupAvatar avatarUrl={group.avatarUrl} name={group.name} className="h-12 w-12 rounded-2xl text-base" /><span className="min-w-0"><strong className="block truncate text-xl font-black">{group.name}</strong><span className="block text-sm font-semibold text-[#64748b]">{group.memberCount} members</span></span></button><button aria-label="Group info" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#64748b] hover:bg-[#f1f5f9]" onClick={() => setIsInfoOpen(true)} type="button"><MoreVertical size={21} /></button></header><div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6" ref={scrollRef}>{messages.length ? <div className="w-full space-y-3">{messages.map((message) => <div className={`flex w-full min-w-0 items-start ${message.mine ? "justify-end" : "justify-start"}`} key={message.id}><div className={`flex min-w-0 max-w-[78%] flex-col ${message.mine ? "items-end" : "items-start"}`}><div className={`min-w-0 max-w-full rounded-2xl border px-4 py-3 shadow-sm ${message.mine ? "border-[#00a884]/20 bg-[#dff8ef]" : "border-[#e5e9f0] bg-white"}`}>{!message.mine ? <div className="mb-1 text-xs font-black text-[#008f70]">{group.members.find((member) => member.id === message.senderId)?.name || message.senderEmail || "Member"}</div> : null}{message.attachment ? <AttachmentPreview attachment={message.attachment} authToken={authToken} /> : null}{message.body ? <p className="text-sm leading-6 text-[#18212f]">{message.body}</p> : null}<div className="mt-2 text-right text-[11px] font-semibold text-[#94a3b8]">{formatGroupTime(message.createdAt || "")}</div></div><MessageReactions align={message.mine ? "right" : "left"} onReact={onReact} onShowDetails={onReactionDetails} pickerTarget={reactionPicker} reactions={message.reactions} setPickerTarget={setReactionPicker} target={{ type: "group", groupId: group.id, messageId: message.id }} /></div></div>)}</div> : <div className="mx-auto mt-20 max-w-md rounded-2xl border border-dashed border-[#cbd5e1] bg-white px-8 py-10 text-center"><Users className="mx-auto text-[#00a884]" size={32} /><h2 className="mt-4 text-lg font-black">Start the group conversation</h2><p className="mt-2 text-sm leading-6 text-[#64748b]">Send the first message to everyone in {group.name}.</p></div>}</div><form className="border-t border-[#e5e9f0] bg-white p-3 sm:p-4" onSubmit={send}>{file ? <div className="mb-2 flex items-center justify-between rounded-xl bg-[#f8fafc] px-3 py-2 text-sm font-bold text-[#334155]">{filePreview ? <img alt="Attachment preview" className="h-10 w-10 rounded-lg object-cover" src={filePreview} /> : <span>{file.name}</span>}<button className="text-[#64748b]" onClick={() => { setFile(null); setFilePreview(""); }} type="button">Remove</button></div> : null}<div className="flex items-center gap-2 rounded-2xl border border-[#dce1e8] bg-[#f8fafc] p-2"><label aria-label="Attach group media" className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl text-[#64748b] hover:bg-white"><Paperclip size={20} /><input accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.apk" className="hidden" onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value=""; }} type="file" /></label>{isRecording ? <button aria-label="Stop recording" className="flex h-10 flex-1 items-center gap-2 px-2 text-sm font-bold text-red-600" onClick={stopRecording} type="button"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />Recording... Click to stop</button> : <input className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Write a group message" value={draft} />}{!draft.trim() && !file && !isRecording ? <button aria-label="Record voice message" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#64748b] hover:bg-white" onClick={startRecording} type="button"><Mic size={20} /></button> : null}<button aria-label="Send group message" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#00a884] text-white disabled:opacity-50" disabled={isSending || (!draft.trim() && !file)} type="submit"><Send size={17} /></button></div></form>{isInfoOpen ? <GroupInfoPanel authToken={authToken} currentUserId={currentUserId} details={group} users={users} canManage={canManage} onClose={() => setIsInfoOpen(false)} onLeave={onLeave} manage={manage} /> : null}</div>;
}

function GroupInfoPanel({ authToken, currentUserId, details, users, canManage, onClose, onLeave, manage }: { authToken: string; currentUserId: string; details: GroupDetails; users: ChatSeed[]; canManage: boolean; onClose: () => void; onLeave: () => void; manage: (method: string, path: string, body?: unknown) => Promise<void> }) {
  const [name, setName] = useState(details.name);
  const [selected, setSelected] = useState<string[]>([]);
  const memberIDs = new Set(details.members.map((member) => member.id));
  const candidates = users.filter((user) => user.id !== currentUserId && !memberIDs.has(user.id));
  const update = async (action: () => Promise<void>) => { try { await action(); } catch (error) { window.alert(error instanceof Error ? error.message : "Group action failed"); } };
  return <div className="fixed inset-0 z-[60] flex justify-end bg-[#0f172a]/35"><div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-[#00a884]">Group info</p><h2 className="mt-1 text-xl font-black">{details.name}</h2></div><button aria-label="Close group info" className="grid h-9 w-9 place-items-center rounded-lg text-[#64748b] hover:bg-[#f8fafc]" onClick={onClose} type="button"><X size={18} /></button></div><div className="mt-5 flex items-center gap-3"><GroupAvatar avatarUrl={details.avatarUrl} name={details.name} className="h-16 w-16 rounded-2xl text-lg" /><div><div className="font-black">{details.memberCount} members</div><div className="text-sm text-[#64748b]">You are {details.role}</div></div></div>{canManage ? <><label className="mt-5 block text-sm font-bold text-[#334155]">Group name<input className="mt-2 h-10 w-full rounded-xl border border-[#dce1e8] px-3 text-sm outline-none focus:border-[#00a884]" onChange={(event) => setName(event.target.value)} value={name} /></label><button className="mt-2 rounded-xl bg-[#e7f8f2] px-3 py-2 text-sm font-black text-[#008f70]" onClick={() => update(() => manage("PATCH", "", { name, avatarUrl: details.avatarUrl || "" }))} type="button">Save name</button></> : null}<h3 className="mt-7 text-xs font-black uppercase tracking-[0.14em] text-[#64748b]">Members</h3><div className="mt-2 divide-y divide-[#edf1f5]">{details.members.map((member) => <div className="flex items-center gap-3 py-3" key={member.id}><GroupAvatar avatarUrl={member.avatarUrl} name={member.name} className="h-10 w-10 rounded-xl text-xs" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-black">{member.name}</div><div className="text-xs capitalize text-[#64748b]">{member.role}</div></div>{details.role === "owner" && member.role !== "owner" ? <button className="text-xs font-black text-[#008f70]" onClick={() => update(() => manage(member.role === "admin" ? "DELETE" : "POST", `/admins/${member.id}`))} type="button">{member.role === "admin" ? "Demote" : "Promote"}</button> : null}{canManage && member.role !== "owner" && (details.role === "owner" || member.role === "member") ? <button className="text-xs font-black text-red-600" onClick={() => update(() => manage("DELETE", `/members/${member.id}`))} type="button">Remove</button> : null}</div>)}</div>{canManage && candidates.length ? <><h3 className="mt-7 text-xs font-black uppercase tracking-[0.14em] text-[#64748b]">Add members</h3><div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-[#edf1f5]">{candidates.map((user) => <button className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#f8fafc] ${selected.includes(user.id) ? "bg-[#effdf8]" : ""}`} key={user.id} onClick={() => setSelected((current) => current.includes(user.id) ? current.filter((id) => id !== user.id) : [...current, user.id])} type="button"><span className="min-w-0 flex-1 truncate font-bold">{user.name}</span>{selected.includes(user.id) ? <Check size={15} className="text-[#00a884]" /> : null}</button>)}</div><button className="mt-2 rounded-xl bg-[#00a884] px-3 py-2 text-sm font-black text-white disabled:opacity-50" disabled={!selected.length} onClick={() => update(async () => { await manage("POST", "/members", { userIds: selected }); setSelected([]); })} type="button">Add selected</button></> : null}{details.role !== "owner" ? <button className="mt-8 w-full rounded-xl bg-red-50 px-3 py-2.5 text-sm font-black text-red-700" onClick={() => update(async () => { await manage("DELETE", `/members/${currentUserId}`); onLeave(); })} type="button">Leave group</button> : <p className="mt-8 rounded-xl bg-[#f8fafc] px-3 py-2 text-xs leading-5 text-[#64748b]">Owners cannot leave. Transfer ownership or delete the group first.</p>}</div></div>;
}



function ContactInfoPanel({
  blocked,
  chat,
  files,
  isOpen,
  links,
  media,
  mediaTab,
  onBlock,
  onClear,
  onClose,
  onMediaTabChange,
  onReport,
  onSearch,
  onStartAudio,
  onStartVideo,
  onUnblock,
}: {
  blocked: boolean;
  chat: ChatSeed;
  files: SharedAttachmentItem[];
  isOpen: boolean;
  links: SharedLinkItem[];
  media: SharedAttachmentItem[];
  mediaTab: ContactInfoMediaTab | null;
  onBlock: () => void;
  onClear: () => void;
  onClose: () => void;
  onMediaTabChange: (tab: ContactInfoMediaTab | null) => void;
  onReport: () => void;
  onSearch: () => void;
  onStartAudio: () => void;
  onStartVideo: () => void;
  onUnblock: () => void;
}) {
  const presenceText = chat.online ? "Online" : formatLastSeen(chat.lastSeenAt);
  const totalShared = media.length + links.length + files.length;
  const panel = (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f9fb]">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-[#e5e9f0] bg-white px-4">
        <button aria-label="Close contact info" className="grid h-10 w-10 place-items-center rounded-xl text-[#64748b] hover:bg-[#f1f5f9]" onClick={onClose} type="button">
          <X size={21} />
        </button>
        <h2 className="text-lg font-black text-[#18212f]">Contact info</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        <section className="py-7 text-center">
          <ChatAvatar chat={chat} className="mx-auto h-28 w-28 rounded-full text-3xl" />
          <h3 className="mt-4 truncate text-2xl font-black text-[#18212f]">{chat.name}</h3>
          <p className={`mt-1 text-sm font-bold ${chat.online ? "text-[#00a884]" : "text-[#64748b]"}`}>{presenceText}</p>
          {chat.preview && chat.preview.includes("@") ? <p className="mt-2 truncate text-sm font-semibold text-[#94a3b8]">{chat.preview}</p> : null}
        </section>

        <section className="grid grid-cols-3 gap-2">
          <ContactQuickAction icon={<Phone size={20} />} label="Voice" onClick={onStartAudio} />
          <ContactQuickAction icon={<Video size={20} />} label="Video" onClick={onStartVideo} />
          <ContactQuickAction icon={<Search size={20} />} label="Search" onClick={onSearch} />
        </section>

        <button className="mt-4 w-full rounded-2xl border border-[#e5e9f0] bg-white p-4 text-left shadow-sm transition hover:border-[#00a884]/30 hover:bg-[#fbfefd]" onClick={() => onMediaTabChange("media")} type="button">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-[#18212f]">Media, links and files</h3>
              <p className="mt-1 text-xs font-semibold text-[#64748b]">{totalShared ? `${media.length} media · ${links.length} links · ${files.length} files` : "No shared items yet"}</p>
            </div>
            <span className="rounded-full bg-[#e7f8f2] px-2.5 py-1 text-xs font-black text-[#008f70]">{totalShared}</span>
          </div>
          {totalShared ? (
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {media.slice(-6).map((item) => <SharedMediaThumb item={item} key={`${item.message.id}-${item.attachment.url}`} />)}
              {!media.length && links.slice(-3).map((item) => <SharedLinkPreview item={item} key={`${item.message.id}-${item.url}`} />)}
              {!media.length && !links.length && files.slice(-3).map((item) => <SharedFilePreview item={item} key={`${item.message.id}-${item.attachment.url}`} />)}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-3 py-4 text-center text-xs font-bold text-[#94a3b8]">Shared photos, videos, links, and files will appear here.</div>
          )}
        </button>

        <section className="mt-4 overflow-hidden rounded-2xl border border-[#e5e9f0] bg-white shadow-sm">
          <ContactActionRow danger label="Clear chat" onClick={onClear} />
          {blocked ? (
            <ContactActionRow label={`Unblock ${chat.name}`} onClick={onUnblock} />
          ) : (
            <ContactActionRow danger label={`Block ${chat.name}`} onClick={onBlock} />
          )}
          <ContactActionRow danger label="Report user" onClick={onReport} />
        </section>
      </div>
    </div>
  );

  return (
    <>
      <aside className={`hidden h-full min-h-0 shrink-0 overflow-hidden border-l border-[#dce1e8] bg-white shadow-[-18px_0_45px_rgba(15,23,42,.08)] transition-[width,opacity] duration-300 lg:block ${isOpen ? "w-[360px] opacity-100 xl:w-[380px]" : "w-0 opacity-0"}`} aria-hidden={!isOpen}>
        {isOpen ? panel : null}
      </aside>
      {isOpen ? (
        <div className="fixed inset-0 z-[70] bg-white lg:hidden">
          {panel}
        </div>
      ) : null}
      {mediaTab ? <SharedMediaDetailsModal files={files} links={links} media={media} onClose={() => onMediaTabChange(null)} tab={mediaTab} setTab={onMediaTabChange} /> : null}
    </>
  );
}

function ContactQuickAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#dce1e8] bg-white px-2 py-3 text-sm font-black text-[#008f70] shadow-sm transition hover:border-[#00a884]/40 hover:bg-[#e7f8f2]" onClick={onClick} type="button">
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ContactActionRow({ danger, label, onClick }: { danger?: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`flex w-full items-center justify-between border-b border-[#edf1f5] px-4 py-3 text-left text-sm font-black last:border-b-0 ${danger ? "text-[#b42318] hover:bg-[#fff5f5]" : "text-[#008f70] hover:bg-[#f8fafc]"}`} onClick={onClick} type="button">
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function SharedMediaThumb({ item }: { item: SharedAttachmentItem }) {
  const isVideo = item.attachment.kind === "video";
  return (
    <a className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-[#e5e9f0] bg-[#f1f5f9]" href={item.source || undefined} rel="noreferrer" target="_blank">
      {isVideo ? (
        <video className="h-full w-full object-cover" src={item.source} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={item.attachment.name} className="h-full w-full object-cover" src={item.source} />
      )}
      {isVideo ? <span className="absolute inset-0 grid place-items-center bg-black/20 text-white"><Play size={20} fill="currentColor" /></span> : null}
    </a>
  );
}

function SharedLinkPreview({ item }: { item: SharedLinkItem }) {
  return (
    <a className="flex h-20 w-40 shrink-0 flex-col justify-between rounded-xl border border-[#e5e9f0] bg-[#f8fafc] p-3 text-xs font-bold text-[#334155]" href={item.url} rel="noreferrer" target="_blank">
      <Link size={17} className="text-[#00a884]" />
      <span className="line-clamp-2 break-all">{item.url}</span>
    </a>
  );
}

function SharedFilePreview({ item }: { item: SharedAttachmentItem }) {
  return (
    <a className="flex h-20 w-40 shrink-0 flex-col justify-between rounded-xl border border-[#e5e9f0] bg-[#f8fafc] p-3 text-xs font-bold text-[#334155]" download={item.attachment.name} href={item.source || undefined}>
      <FileText size={18} className="text-[#00a884]" />
      <span className="line-clamp-2">{item.attachment.name}</span>
    </a>
  );
}

function SharedMediaDetailsModal({
  files,
  links,
  media,
  onClose,
  setTab,
  tab,
}: {
  files: SharedAttachmentItem[];
  links: SharedLinkItem[];
  media: SharedAttachmentItem[];
  onClose: () => void;
  setTab: (tab: ContactInfoMediaTab | null) => void;
  tab: ContactInfoMediaTab;
}) {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[#0f172a]/40 px-3" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#dce1e8] bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#e5e9f0] px-4 py-3">
          <h2 className="text-base font-black text-[#18212f]">Media, links and files</h2>
          <button aria-label="Close shared media" className="grid h-9 w-9 place-items-center rounded-lg text-[#64748b] hover:bg-[#f8fafc]" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-3 gap-2 border-b border-[#e5e9f0] p-3">
          {(["media", "links", "files"] as ContactInfoMediaTab[]).map((item) => (
            <button className={`rounded-xl px-3 py-2 text-sm font-black ${tab === item ? "bg-[#e7f8f2] text-[#008f70]" : "text-[#64748b] hover:bg-[#f8fafc]"}`} key={item} onClick={() => setTab(item)} type="button">
              {item === "media" ? "Media" : item === "links" ? "Links" : "Files"}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "media" ? <SharedMediaGrid items={media} /> : null}
          {tab === "links" ? <SharedLinksList items={links} /> : null}
          {tab === "files" ? <SharedFilesList items={files} /> : null}
        </div>
      </div>
    </div>
  );
}

function SharedMediaGrid({ items }: { items: SharedAttachmentItem[] }) {
  if (!items.length) return <SharedEmptyState label="No media shared in this chat yet." />;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {items.map((item) => <SharedMediaThumb item={item} key={`${item.message.id}-${item.attachment.url}`} />)}
    </div>
  );
}

function SharedLinksList({ items }: { items: SharedLinkItem[] }) {
  if (!items.length) return <SharedEmptyState label="No links shared in this chat yet." />;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <a className="flex items-start gap-3 rounded-xl border border-[#e5e9f0] bg-[#f8fafc] p-3 text-sm font-bold text-[#334155] hover:border-[#00a884]/30" href={item.url} key={`${item.message.id}-${item.url}`} rel="noreferrer" target="_blank">
          <Link size={18} className="mt-0.5 shrink-0 text-[#00a884]" />
          <span className="min-w-0 break-all">{item.url}</span>
        </a>
      ))}
    </div>
  );
}

function SharedFilesList({ items }: { items: SharedAttachmentItem[] }) {
  if (!items.length) return <SharedEmptyState label="No files shared in this chat yet." />;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <a className="flex items-center gap-3 rounded-xl border border-[#e5e9f0] bg-[#f8fafc] p-3 text-sm font-bold text-[#334155] hover:border-[#00a884]/30" download={item.attachment.name} href={item.source || undefined} key={`${item.message.id}-${item.attachment.url}`}>
          <FileText size={20} className="shrink-0 text-[#00a884]" />
          <span className="min-w-0 flex-1 truncate">{item.attachment.name}</span>
        </a>
      ))}
    </div>
  );
}

function SharedEmptyState({ label }: { label: string }) {
  return <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-10 text-center text-sm font-bold text-[#94a3b8]">{label}</div>;
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

  if (attachment.kind === "audio" && canPreview) {
    return <AudioPlayer source={source} name={attachment.name} />;
  }

  return (
    <a className="mb-3 flex items-center gap-3 rounded-md border border-[#dce1e8] bg-white/70 px-3 py-3 text-sm font-bold text-[#334155]" href={source || undefined} download={attachment.name}>
      <FileText size={20} />
      <span className="min-w-0 truncate">{attachment.name}</span>
    </a>
  );
}

function AudioPlayer({ source, name }: { source: string; name: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const parsedDuration = useMemo(() => {
    const match = name.match(/voice-message_(\d+(\.\d+)?)s\./);
    return match ? parseFloat(match[1]) : 0;
  }, [name]);

  useEffect(() => {
    if (parsedDuration > 0) {
      setDuration(parsedDuration);
    }
  }, [parsedDuration]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => {
        setIsPlaying(true);
      }).catch((err) => {
        console.error("Audio playback failed:", err);
      });
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
  };

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setDuration(audio.duration || parsedDuration);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    audio.currentTime = time;
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl border border-[#dce1e8] bg-white/90 p-3 text-sm text-[#334155] w-[calc(72vw-70px)] sm:w-[280px] max-w-[280px] min-w-0 shadow-sm">
      <audio
        ref={audioRef}
        src={source}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />
      <button
        aria-label={isPlaying ? "Pause" : "Play"}
        className="cs-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white hover:bg-[#008f70]"
        onClick={togglePlay}
        type="button"
      >
        {isPlaying ? (
          <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg className="h-5 w-5 fill-current translate-x-[1px]" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <input
          type="range"
          min="0"
          max={duration || 100}
          value={currentTime}
          onChange={handleSliderChange}
          className="w-full accent-[#00a884] cursor-pointer"
        />
        <div className="flex justify-between text-[10px] font-bold text-[#64748b] mt-1">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

const peaksCache = new Map<string, number[]>();

function getFallbackPeaks(seed: string, count: number): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / (count - 1)) * Math.PI;
    const shape = Math.sin(angle);
    const rand = Math.abs(Math.sin(hash + i * 13.7)) * 0.5 + 0.3;
    const val = shape * rand + 0.15;
    peaks.push(Math.min(1.0, Math.max(0.15, val)));
  }
  return peaks;
}

async function getPeaksFromAudio(url: string, count: number): Promise<number[]> {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const response = await fetch(url);
    if (!response.ok) throw new Error("Fetch failed");
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const rawData = audioBuffer.getChannelData(0);
    const blockSize = Math.floor(rawData.length / count);
    const peaks: number[] = [];
    for (let i = 0; i < count; i++) {
      let max = 0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize; j++) {
        const val = Math.abs(rawData[start + j]);
        if (val > max) {
          max = val;
        }
      }
      peaks.push(max);
    }
    const maxPeak = Math.max(...peaks) || 1;
    return peaks.map(p => Math.max(0.15, p / maxPeak));
  } catch (err) {
    console.warn("Could not decode audio peaks, falling back to deterministic peaks:", err);
    return getFallbackPeaks(url, count);
  }
}

const pauseAllOtherAudios = (currentAudio: HTMLAudioElement) => {
  if (typeof document === "undefined") return;
  const audios = document.querySelectorAll("audio");
  audios.forEach((audio) => {
    if (audio !== currentAudio) {
      audio.pause();
    }
  });
};

function VoiceMessageBubble({
  message,
  authToken,
  selectedChat,
  onRetry
}: {
  message: ChatMessage;
  authToken: string;
  selectedChat: any;
  onRetry?: (message: ChatMessage) => void;
}) {
  const attachment = message.attachment!;
  const [failed, setFailed] = useState(false);
  const source = attachmentSource(attachment.url, authToken);
  const canPreview = Boolean(source && /^(https?:|data:|blob:)/i.test(source) && !failed);

  if (!canPreview) {
    return (
      <div className={`max-w-[72%] rounded-2xl border px-4 py-3 shadow-sm ${message.mine ? "border-[#00a884]/20 bg-[#dff8ef]" : "border-[#e5e9f0] bg-white"}`}>
        <a className="flex items-center gap-3 rounded-md border border-[#dce1e8] bg-white/70 px-3 py-3 text-sm font-bold text-[#334155]" href={source || undefined} download={attachment.name}>
          <FileText size={20} />
          <span className="min-w-0 truncate">{attachment.name}</span>
        </a>
        <div className="mt-2 flex justify-end gap-1 text-xs font-semibold text-[#94a3b8]">
          {formatMessageTime(message)}
          {message.mine && (
            <div className="flex items-center gap-1">
              {message.status === "uploading" ? (
                <span>{message.progressMsg || "Uploading..."}</span>
              ) : message.status === "sending" ? (
                <span>{message.progressMsg || "Sending..."}</span>
              ) : message.status === "failed" ? (
                <span className="text-[#b42318] flex items-center gap-1">
                  <span>{message.progressMsg || "⚠ Failed"}</span>
                  {onRetry && (
                    <button
                      onClick={() => onRetry(message)}
                      className="underline font-bold text-sky-600 hover:text-sky-800 ml-1 cursor-pointer focus:outline-none"
                      type="button"
                    >
                      Retry
                    </button>
                  )}
                </span>
              ) : (
                <>
                  <span>{message.readAt ? "Seen" : "Sent"}</span>
                  {message.readAt ? (
                    <CheckCheck size={15} className="text-[#00a884]" />
                  ) : selectedChat?.online ? (
                    <CheckCheck size={15} className="text-[#94a3b8]" />
                  ) : (
                    <Check size={15} className="text-[#94a3b8]" />
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <VoiceMessagePlayer
      source={source}
      name={attachment.name}
      message={message}
      selectedChat={selectedChat}
      onRetry={onRetry}
    />
  );
}

function VoiceMessagePlayer({
  source,
  name,
  message,
  selectedChat,
  onRetry
}: {
  source: string;
  name: string;
  message: ChatMessage;
  selectedChat: any;
  onRetry?: (message: ChatMessage) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const barsCount = 35;

  const parsedDuration = useMemo(() => {
    const match = name.match(/voice-message_(\d+(\.\d+)?)s\./);
    return match ? parseFloat(match[1]) : 0;
  }, [name]);

  useEffect(() => {
    if (parsedDuration > 0) {
      setDuration(parsedDuration);
    }
  }, [parsedDuration]);

  useEffect(() => {
    if (!source) return;
    if (peaksCache.has(source)) {
      setPeaks(peaksCache.get(source)!);
      return;
    }

    let isMounted = true;
    getPeaksFromAudio(source, barsCount).then((data) => {
      if (isMounted) {
        peaksCache.set(source, data);
        setPeaks(data);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [source]);

  const displayPeaks = useMemo(() => {
    if (peaks.length === barsCount) return peaks;
    return getFallbackPeaks(source || name, barsCount);
  }, [peaks, source, name]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      pauseAllOtherAudios(audio);
      audio.play().catch((err) => {
        console.error("Audio playback failed:", err);
      });
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
  };

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setDuration(audio.duration || parsedDuration);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handlePlay = () => {
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handleSeek = (ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const newTime = ratio * duration;
    setCurrentTime(newTime);
    audio.currentTime = newTime;
  };

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    handleSeek(ratio);
  };

  const handleWaveformTouch = (e: React.TouchEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const touch = e.touches[0];
    if (!touch) return;
    const clickX = touch.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    handleSeek(ratio);
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const progressRatio = duration > 0 ? currentTime / duration : 0;
  const activeBarsCount = Math.floor(progressRatio * barsCount);
  const displayTime = isPlaying || currentTime > 0 ? currentTime : duration;

  return (
    <div className={`relative flex items-center gap-3 p-3 pl-4 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.12)] border select-none w-full max-w-[280px] sm:max-w-[320px] min-w-[240px] ${
      message.mine 
        ? "bg-[#dff8ef] border-[#00a884]/15 rounded-bl-2xl rounded-br-none" 
        : "bg-white border-[#e5e9f0] rounded-2xl rounded-bl-none ml-2"
    }`}>
      {/* SVG Tail */}
      <svg
        className={`absolute bottom-0 left-[-7px] h-[13px] w-[8px] fill-current ${
          message.mine ? "text-[#dff8ef]" : "text-white"
        }`}
        viewBox="0 0 8 13"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M8 13V0C6 3 2 7.5 0 13H8Z" />
      </svg>

      <audio
        ref={audioRef}
        src={source}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPlay={handlePlay}
        onPause={handlePause}
      />

      {/* Play/Pause Button */}
      <button
        aria-label={isPlaying ? "Pause" : "Play"}
        className="cs-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0284c7] hover:bg-[#0369a1] text-white transition-colors shadow-sm"
        onClick={togglePlay}
        type="button"
      >
        {isPlaying ? (
          <Pause className="h-5 w-5 fill-white text-white" />
        ) : (
          <Play className="h-5 w-5 fill-white text-white translate-x-[1.5px]" />
        )}
      </button>

      {/* Waveform & Info */}
      <div className="flex-1 flex flex-col min-w-0">
        <div
          onClick={handleWaveformClick}
          onTouchStart={handleWaveformTouch}
          onTouchMove={handleWaveformTouch}
          className="h-8 flex items-center gap-[2.5px] cursor-pointer w-full select-none"
        >
          {displayPeaks.map((peak, idx) => {
            const isPlayed = idx < activeBarsCount;
            return (
              <div
                key={idx}
                className="flex-1 rounded-full transition-colors duration-100"
                style={{
                  height: `${peak * 100}%`,
                  maxHeight: "100%",
                  backgroundColor: isPlayed ? "#0284c7" : "#cbd5e1",
                  minHeight: "4px"
                }}
              />
            );
          })}
        </div>

        {/* Metadata row */}
        <div className="flex justify-between items-center text-[10px] sm:text-[11px] font-medium text-[#64748b] mt-1 select-none">
          <span>{formatTime(displayTime)}</span>
          <div className="flex items-center gap-1">
            <span>{formatMessageTime(message)}</span>
            {message.mine && (
              <div className="flex items-center gap-1">
                {message.status === "uploading" ? (
                  <span>{message.progressMsg || "Uploading..."}</span>
                ) : message.status === "sending" ? (
                  <span>{message.progressMsg || "Sending..."}</span>
                ) : message.status === "failed" ? (
                  <span className="text-[#b42318] flex items-center gap-1">
                    <span>{message.progressMsg || "⚠ Failed"}</span>
                    {onRetry && (
                      <button
                        onClick={() => onRetry(message)}
                        className="underline font-bold text-sky-600 hover:text-sky-800 ml-1 cursor-pointer focus:outline-none"
                        type="button"
                      >
                        Retry
                      </button>
                    )}
                  </span>
                ) : (
                  <>
                    <span>{message.readAt ? "Seen" : "Sent"}</span>
                    {message.readAt ? (
                      <CheckCheck size={14} className="text-[#00a884]" />
                    ) : selectedChat?.online ? (
                      <CheckCheck size={14} className="text-[#94a3b8]" />
                    ) : (
                      <Check size={14} className="text-[#94a3b8]" />
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
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
        <AvatarImage alt={chat.name} className="h-full w-full object-cover" fallback={chat.avatar} src={chat.avatarUrl} />
      ) : (
        chat.avatar
      )}
    </span>
  );
}

function MessageReactions({
  align,
  onReact,
  onShowDetails,
  pickerTarget,
  reactions,
  setPickerTarget,
  target
}: {
  align: "left" | "right";
  onReact: (target: ReactionTarget, emoji: string) => void;
  onShowDetails: (details: { emoji: string; users: ReactionUser[] }) => void;
  pickerTarget: ReactionTarget | null;
  reactions?: ReactionSummary[];
  setPickerTarget: (target: ReactionTarget | null) => void;
  target: ReactionTarget;
}) {
  const isPickerOpen = pickerTarget?.type === target.type && pickerTarget.messageId === target.messageId && pickerTarget.groupId === target.groupId;
  return (
    <div className={`relative mt-1 flex flex-wrap items-center gap-1 ${align === "right" ? "justify-end" : "justify-start"}`} data-reaction-picker={isPickerOpen ? "true" : undefined}>
      <button
        aria-label="React to message"
        className="grid h-7 w-7 place-items-center rounded-full border border-[#dce1e8] bg-white text-[#64748b] shadow-sm transition hover:border-[#00a884] hover:text-[#00a884]"
        onClick={(event) => {
          event.stopPropagation();
          setPickerTarget(isPickerOpen ? null : target);
        }}
        type="button"
      >
        <Smile size={14} />
      </button>
      {(reactions ?? []).map((reaction) => (
        <button
          className={`inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs font-black ${
            reaction.reactedByMe ? "border-[#00a884]/40 bg-[#e7f8f2] text-[#008f70]" : "border-[#dce1e8] bg-white text-[#334155]"
          }`}
          key={reaction.emoji}
          onClick={() => onShowDetails({ emoji: reaction.emoji, users: reaction.users ?? [] })}
          type="button"
        >
          <span>{reaction.emoji}</span>
          <span>{reaction.count}</span>
        </button>
      ))}
      {isPickerOpen ? (
        <div className={`absolute bottom-9 z-40 flex gap-1 rounded-full border border-[#dce1e8] bg-white p-1 shadow-[0_14px_35px_rgba(15,23,42,.16)] ${align === "right" ? "right-0" : "left-0"}`}>
          {REACTION_EMOJIS.map((emoji) => (
            <button
              className="grid h-9 w-9 place-items-center rounded-full text-lg transition hover:bg-[#e7f8f2]"
              key={emoji}
              onClick={(event) => {
                event.stopPropagation();
                onReact(target, emoji);
              }}
              type="button"
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AvatarImage({ alt, className, fallback, src }: { alt: string; className?: string; fallback: ReactNode; src: string }) {
  const [failedSrc, setFailedSrc] = useState("");

  useEffect(() => {
    setFailedSrc("");
  }, [src]);

  if (!src || failedSrc === src) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} className={className} onError={() => setFailedSrc(src)} src={src} />
  );
}

function AvatarSelection({
  currentPreview,
  fallback = <Upload size={28} />,
  inputId,
  labelTone,
  onChooseBuiltIn,
  onChooseGallery,
  selectedBuiltInAvatar,
  title
}: {
  currentPreview: string;
  fallback?: ReactNode;
  inputId: string;
  labelTone: "dark" | "light";
  onChooseBuiltIn: (src: string) => void;
  onChooseGallery: (event: ChangeEvent<HTMLInputElement>) => void;
  selectedBuiltInAvatar: string;
  title: string;
}) {
  const isDark = labelTone === "dark";
  return (
    <div className={`rounded-md border p-4 ${isDark ? "border-white/10 bg-[#0b141a]" : "border-[#e5e9f0] bg-[#f8fafc]"}`}>
      <div className={`text-sm font-bold ${isDark ? "text-white" : "text-[#18212f]"}`}>{title}</div>
      <div className="mt-4 grid grid-cols-5 gap-2 sm:gap-3">
        {BUILT_IN_AVATARS.map((avatar, index) => {
          const selected = selectedBuiltInAvatar === avatar.src;
          return (
            <button
              aria-label={`Choose ChatSphere avatar ${index + 1}`}
              aria-pressed={selected}
              className={`relative grid aspect-square shrink-0 place-items-center rounded-full border-2 p-1 transition ${
                selected ? "border-[#00a884] bg-[#e7f8f2] shadow-[0_0_0_3px_rgba(0,168,132,.18)]" : isDark ? "border-white/10 bg-[#17251f] hover:border-[#00a884]/70" : "border-[#dce1e8] bg-white hover:border-[#00a884]/70"
              }`}
              key={avatar.id}
              onClick={() => onChooseBuiltIn(avatar.src)}
              type="button"
            >
              <span className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-[#e7f8f2] text-xs font-black text-[#008f70]">
                <AvatarImage alt={`ChatSphere avatar ${index + 1}`} className="h-full w-full object-cover" fallback={<Image size={20} />} src={avatar.src} />
              </span>
              {selected ? <span className="absolute bottom-0 right-0 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-[#00a884] text-white sm:h-6 sm:w-6"><Check size={13} strokeWidth={3} /></span> : null}
            </button>
          );
        })}
      </div>
      <div className={`my-4 flex items-center gap-3 text-xs font-black uppercase ${isDark ? "text-[#8696a0]" : "text-[#94a3b8]"}`}>
        <span className={`h-px flex-1 ${isDark ? "bg-white/10" : "bg-[#dce1e8]"}`} />
        or
        <span className={`h-px flex-1 ${isDark ? "bg-white/10" : "bg-[#dce1e8]"}`} />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span className={`grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full ${isDark ? "bg-[#202c33] text-[#00a884]" : "bg-[#e7f8f2] text-[#008f70]"} text-sm font-black`}>
          {currentPreview ? <AvatarImage alt="Profile preview" className="h-full w-full object-cover" fallback={fallback} src={currentPreview} /> : fallback}
        </span>
        <label className="cs-press inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#00a884] px-4 text-sm font-black text-white shadow-[0_12px_28px_rgba(0,168,132,.18)]">
          <Upload size={17} />
          Choose from Gallery
          <input id={inputId} accept="image/*" className="hidden" onChange={onChooseGallery} type="file" />
        </label>
      </div>
    </div>
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
