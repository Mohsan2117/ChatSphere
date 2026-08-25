"use client";

import { useEffect, useRef, useState, type Ref, type RefObject, type ReactNode } from "react";
import type { EmojiClickData } from "emoji-picker-react";
import { ArrowLeft, MessageCircle, MoreVertical, Phone, Search, Video } from "lucide-react";
import type { ChatSeed } from "@/lib/data";
import { MessageBubble, type BubbleMessage, type MessageReply } from "./MessageBubble";
import { MessageComposer } from "./MessageComposer";
import type { ReactionSummary, ReactionTarget, ReactionUser } from "./MessageReactions";

type DirectChatMessage = BubbleMessage & {
  senderEmail?: string;
  senderId?: string;
  recipientId?: string;
  localSeq?: number;
  reactions?: ReactionSummary[];
};

type ComposerAttachment = NonNullable<DirectChatMessage["attachment"]> & { file?: File };

type ChatPanelProps<TMessage extends DirectChatMessage> = {
  attachment: ComposerAttachment | null;
  authToken: string;
  avatar: ReactNode;
  chat: ChatSeed;
  chatMessageSearch: string;
  chatMessageSearchRef: Ref<HTMLInputElement>;
  chatNotice: string;
  disabled: boolean;
  emojiPickerOpen: boolean;
  isChatMenuOpen: boolean;
  isChatSearchOpen: boolean;
  isClearingChat: boolean;
  isContactInfoOpen: boolean;
  isRecording: boolean;
  isSavingEdit?: boolean;
  messages: TMessage[];
  onBlock: () => void;
  onCancelEdit: () => void;
  onCancelRecording: () => void;
  onChangeDraft: (value: string) => void;
  onClear: () => void;
  onCloseChat: () => void;
  onEmojiSelect: (emoji: EmojiClickData) => void;
  onEmojiToggle: () => void;
  onFileAttachment: (file: File) => void;
  onMediaAttachment: (file: File) => void;
  onOpenContactInfo: () => void;
  onOpenReactionDetails: (details: { emoji: string; users: ReactionUser[] }) => void;
  onCancelReply: () => void;
  onDelete: (message: TMessage) => void;
  onEdit: (message: TMessage) => void;
  onReact: (target: ReactionTarget, emoji: string) => void;
  onReply: (message: TMessage) => void;
  onRemoveAttachment: () => void;
  onReport: () => void;
  onRetry: (message: TMessage) => void;
  onScroll: () => void;
  onSearchChange: (value: string) => void;
  onSend: () => void;
  onSendRecording: () => void;
  onStartAudioCall: () => void;
  onStartRecording: () => void;
  onStartVideoCall: () => void;
  onToggleChatMenu: () => void;
  onToggleChatSearch: () => void;
  onToggleStar: (message: TMessage) => void;
  onUnblock: () => void;
  reactionPicker: ReactionTarget | null;
  recordingDuration: number;
  editMode?: { originalBody: string } | null;
  replyTo?: MessageReply | null;
  resolveAttachmentSource: (url: string, token: string) => string;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  setReactionPicker: (target: ReactionTarget | null) => void;
  timestamp: (message: TMessage) => ReactNode;
  typingUser: string | null;
  value: string;
  formatLastSeen: (lastSeenAt?: string) => string;
  externalHighlightedMessageId?: string;
};

export function ChatPanel<TMessage extends DirectChatMessage>({
  attachment,
  authToken,
  avatar,
  chat,
  chatMessageSearch,
  chatMessageSearchRef,
  chatNotice,
  disabled,
  emojiPickerOpen,
  isChatMenuOpen,
  isChatSearchOpen,
  isClearingChat,
  isContactInfoOpen,
  isRecording,
  isSavingEdit,
  messages,
  onBlock,
  onCancelEdit,
  onCancelRecording,
  onChangeDraft,
  onClear,
  onCloseChat,
  onEmojiSelect,
  onEmojiToggle,
  onFileAttachment,
  onMediaAttachment,
  onOpenContactInfo,
  onOpenReactionDetails,
  onCancelReply,
  onDelete,
  onEdit,
  onReact,
  onReply,
  onRemoveAttachment,
  onReport,
  onRetry,
  onScroll,
  onSearchChange,
  onSend,
  onSendRecording,
  onStartAudioCall,
  onStartRecording,
  onStartVideoCall,
  onToggleChatMenu,
  onToggleChatSearch,
  onToggleStar,
  onUnblock,
  reactionPicker,
  recordingDuration,
  editMode,
  replyTo,
  resolveAttachmentSource,
  scrollContainerRef,
  setReactionPicker,
  timestamp,
  typingUser,
  value,
  formatLastSeen,
  externalHighlightedMessageId
}: ChatPanelProps<TMessage>) {
  const [highlightedMessageId, setHighlightedMessageId] = useState("");
  const highlightTimeoutRef = useRef<number | null>(null);
  const scrollToOriginal = (messageId: string) => {
    const container = scrollContainerRef.current;
    const target = container?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(messageId);
    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightedMessageId(""), 1400);
  };

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    };
  }, []);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[#071019] text-[#E5E7EB]">
      <header className="flex min-h-[82px] items-center justify-between gap-3 border-b border-white/10 bg-[#0E1726] px-4 sm:px-6">
        <div className={`min-w-0 items-center gap-3 sm:gap-4 ${isChatSearchOpen ? "hidden sm:flex" : "flex"}`}>
          <button aria-label="Back to chats" className="cs-press grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#9AA3B8] hover:bg-white/10 hover:text-white lg:hidden" onClick={onCloseChat} type="button">
            <ArrowLeft size={22} />
          </button>
          <button className="flex min-w-0 items-center gap-3 rounded-2xl pr-2 text-left transition hover:bg-white/[0.04] sm:gap-4" onClick={onOpenContactInfo} type="button">
            {avatar}
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold text-[#E5E7EB]">{chat.name}</h2>
              <p className={`text-sm font-semibold ${chat.online ? "text-[#38BDF8]" : "text-[#9AA3B8]"}`}>{chat.online ? "Online" : formatLastSeen(chat.lastSeenAt)}</p>
            </div>
          </button>
        </div>
        <div className={`relative flex min-w-0 items-center justify-end gap-2 text-[#9AA3B8] sm:gap-4 ${isChatSearchOpen ? "flex-1" : ""}`}>
          {isChatSearchOpen ? (
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-[#152035]/60 px-3 sm:w-72 sm:flex-none">
              <Search size={18} className="text-[#9AA3B8]" />
              <input
                ref={chatMessageSearchRef}
                className="min-w-0 flex-1 bg-transparent text-sm text-[#E5E7EB] outline-none placeholder:text-[#64748B]"
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search this chat"
                value={chatMessageSearch}
              />
            </label>
          ) : null}
          {chat.id !== "chatsphere-ai" && (
            <>
              <button
                aria-label="Start audio call"
                className="cs-press grid h-10 w-10 place-items-center rounded-xl hover:bg-white/10 text-[#9AA3B8] hover:text-[#38BDF8] transition"
                onClick={onStartAudioCall}
                type="button"
              >
                <Phone size={21} />
              </button>
              <button
                aria-label="Start video call"
                className="cs-press grid h-10 w-10 place-items-center rounded-xl hover:bg-white/10 text-[#9AA3B8] hover:text-[#38BDF8] transition"
                onClick={onStartVideoCall}
                type="button"
              >
                <Video size={21} />
              </button>
            </>
          )}
          <button aria-label="Chat options" className="cs-press grid h-10 w-10 place-items-center rounded-xl text-[#9AA3B8] hover:bg-white/10 hover:text-white transition" onClick={onToggleChatMenu} type="button">
            <MoreVertical size={23} />
          </button>
          {isChatMenuOpen ? (
            <div className="cs-scale-in absolute right-0 top-12 z-30 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#0E1726] py-2 text-sm font-semibold text-[#E5E7EB] shadow-[0_18px_45px_rgba(0,0,0,0.6)] backdrop-blur-xl">
              <div className="border-b border-white/10 px-4 py-3">
                <div className="truncate font-bold text-[#E5E7EB]">{chat.name}</div>
                <div className={`mt-1 text-xs ${chat.online ? "text-[#38BDF8]" : "text-[#9AA3B8]"}`}>{chat.online ? "Online" : formatLastSeen(chat.lastSeenAt)}</div>
              </div>
              <button className="flex w-full items-center px-4 py-3 text-left hover:bg-white/[0.06] text-[#E5E7EB]" onClick={onToggleChatSearch} type="button">Search messages</button>
              <button className="flex w-full items-center px-4 py-3 text-left hover:bg-white/[0.06] text-[#E5E7EB]" onClick={onReport} type="button">Report user</button>
              {disabled ? (
                <button className="flex w-full items-center px-4 py-3 text-left hover:bg-white/[0.06] text-[#38BDF8]" onClick={onUnblock} type="button">Unblock user</button>
              ) : (
                <button className="flex w-full items-center px-4 py-3 text-left text-red-400 hover:bg-red-500/10" onClick={onBlock} type="button">Block user</button>
              )}
              <button className={`flex w-full items-center px-4 py-3 text-left text-red-400 ${isClearingChat ? "opacity-50 cursor-not-allowed" : "hover:bg-red-500/10"}`} onClick={onClear} disabled={isClearingChat} type="button">
                {isClearingChat ? "Chat clearing..." : "Clear chat"}
              </button>
              <button className="flex w-full items-center px-4 py-3 text-left hover:bg-white/[0.06] text-[#9AA3B8]" onClick={onCloseChat} type="button">Close chat</button>
            </div>
          ) : null}
        </div>
      </header>

      <div ref={scrollContainerRef as Ref<HTMLDivElement>} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 pb-28 sm:px-6 sm:py-8 sm:pb-32 bg-[#071019]">
        <div className="mx-auto mb-8 w-fit rounded-full border border-white/10 bg-[#152035] px-4 py-2 text-xs font-semibold text-[#9AA3B8] shadow-sm">Conversation started</div>
        {messages.length ? (
          <div className="space-y-4">
            {messages.map((message) => (
              <MessageBubble
                authToken={authToken}
                key={message.id}
                message={message}
                highlighted={highlightedMessageId === message.id || externalHighlightedMessageId === message.id}
                onOpenReactionDetails={onOpenReactionDetails}
                onQuoteClick={scrollToOriginal}
                onDelete={onDelete}
                onEdit={onEdit}
                onReact={onReact}
                onReply={onReply}
                onRetry={onRetry}
                onToggleStar={onToggleStar}
                reactionPicker={reactionPicker}
                reactionTarget={{ type: "direct", messageId: message.id }}
                resolveAttachmentSource={resolveAttachmentSource}
                selectedChatOnline={chat.online}
                setReactionPicker={setReactionPicker}
                timestamp={timestamp(message)}
                variant="direct"
              />
            ))}
          </div>
        ) : (
          <div className="mx-auto mt-20 max-w-md rounded-3xl border border-dashed border-white/15 bg-[#152035]/30 px-8 py-10 text-center text-sm leading-6 text-[#9AA3B8]">
            <MessageCircle className="mx-auto text-[#38BDF8]" size={34} />
            <h3 className="mt-4 text-lg font-bold text-[#E5E7EB]">{chatMessageSearch.trim() ? "No matching messages" : "No messages yet"}</h3>
            <p className="mt-2">{chatMessageSearch.trim() ? "Try a different word from this conversation." : "Write the first message below. Attachments and emojis are ready."}</p>
          </div>
        )}
      </div>

      <footer className={`fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0E1726] px-3 py-3 shadow-[0_-14px_35px_rgba(0,0,0,0.5)] sm:px-5 lg:left-[600px] xl:left-[660px] ${isContactInfoOpen ? "lg:right-[360px] xl:right-[380px]" : ""}`}>
        <MessageComposer
          attachment={attachment}
          disabled={disabled}
          emojiPickerOpen={emojiPickerOpen}
          isRecording={isRecording}
          mode="direct"
          notice={chatNotice}
          onCancelRecording={onCancelRecording}
          onChange={onChangeDraft}
          onEmojiSelect={onEmojiSelect}
          onEmojiToggle={onEmojiToggle}
          onFileAttachment={onFileAttachment}
          onMediaAttachment={onMediaAttachment}
          onRemoveAttachment={onRemoveAttachment}
          onCancelReply={onCancelReply}
          onCancelEdit={onCancelEdit}
          editMode={editMode}
          isSavingEdit={isSavingEdit}
          onSend={onSend}
          onSendRecording={onSendRecording}
          onStartRecording={onStartRecording}
          placeholder={disabled ? "Unblock this user to send messages" : "Write a message"}
          recordingDuration={recordingDuration}
          replyTo={replyTo}
          typingUser={typingUser}
          value={value}
        />
      </footer>
    </div>
  );
}
