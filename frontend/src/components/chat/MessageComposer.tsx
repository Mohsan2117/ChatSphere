"use client";

import { FormEvent, KeyboardEvent, useRef } from "react";
import EmojiPicker, { EmojiClickData, Theme } from "emoji-picker-react";
import { Image, Mic, Paperclip, Send, Smile, X } from "lucide-react";
import type { MessageReply } from "./MessageBubble";

type ComposerAttachment = {
  name: string;
  type: string;
  url: string;
  kind: "image" | "video" | "file" | "audio";
};

type DirectMessageComposerProps = {
  attachment: ComposerAttachment | null;
  disabled?: boolean;
  editMode?: { originalBody: string } | null;
  emojiPickerOpen: boolean;
  isRecording: boolean;
  isSavingEdit?: boolean;
  notice?: string;
  onCancelEdit?: () => void;
  onCancelRecording: () => void;
  onChange: (value: string) => void;
  onEmojiSelect: (emoji: EmojiClickData) => void;
  onEmojiToggle: () => void;
  onFileAttachment: (file: File) => void;
  onMediaAttachment: (file: File) => void;
  onRemoveAttachment: () => void;
  onCancelReply?: () => void;
  onSend: () => void;
  onSendRecording: () => void;
  onStartRecording: () => void;
  placeholder: string;
  recordingDuration: number;
  typingUser?: string | null;
  value: string;
  replyTo?: MessageReply | null;
};

type GroupMessageComposerProps = {
  attachmentFile: File | null;
  attachmentPreview: string;
  editMode?: { originalBody: string } | null;
  isRecording: boolean;
  isSending: boolean;
  isSavingEdit?: boolean;
  onAttachment: (file: File | undefined) => void;
  onChange: (value: string) => void;
  onCancelEdit?: () => void;
  onRemoveAttachment: () => void;
  onCancelReply?: () => void;
  onSend: (event?: FormEvent) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  value: string;
  replyTo?: MessageReply | null;
};

type MessageComposerProps =
  | ({ mode: "direct" } & DirectMessageComposerProps)
  | ({ mode: "group" } & GroupMessageComposerProps);

const FILE_ACCEPT = "image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.apk";

function replyPreviewText(reply: MessageReply) {
  const body = reply.body?.trim();
  if (body) return body;
  if (reply.attachmentKind) {
    return reply.attachmentKind === "audio" ? "Voice message" : `${reply.attachmentKind.charAt(0).toUpperCase()}${reply.attachmentKind.slice(1)} message`;
  }
  return "Message";
}

function ComposerReplyPreview({ reply, onCancel }: { reply?: MessageReply | null; onCancel?: () => void }) {
  if (!reply) return null;
  return (
    <div className="mb-3 flex min-w-0 items-center gap-3 rounded-xl border border-white/10 border-l-4 border-l-[#38BDF8] bg-[#152035]/80 px-3 py-2 text-sm text-[#E5E7EB]">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-bold text-[#38BDF8]">Replying to {reply.senderName || "message"}</div>
        <div className="mt-0.5 truncate text-xs font-semibold text-[#9AA3B8]">{replyPreviewText(reply)}</div>
      </div>
      {onCancel ? (
        <button aria-label="Cancel reply" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#9AA3B8] hover:bg-white/10 hover:text-white" onClick={onCancel} type="button">
          <X size={16} />
        </button>
      ) : null}
    </div>
  );
}

function ComposerEditPreview({ body, onCancel }: { body?: string; onCancel?: () => void }) {
  if (!body) return null;
  return (
    <div className="mb-3 flex min-w-0 items-center gap-3 rounded-xl border border-white/10 border-l-4 border-l-[#38BDF8] bg-[#152035]/80 px-3 py-2 text-sm text-[#E5E7EB]">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-bold text-[#38BDF8]">Editing message</div>
        <div className="mt-0.5 truncate text-xs font-semibold text-[#9AA3B8]">{body}</div>
      </div>
      {onCancel ? (
        <button aria-label="Cancel edit" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#9AA3B8] hover:bg-white/10 hover:text-white" onClick={onCancel} type="button">
          <X size={16} />
        </button>
      ) : null}
    </div>
  );
}

export function MessageComposer(props: MessageComposerProps) {
  if (props.mode === "group") {
    return <GroupMessageComposer {...props} />;
  }

  return <DirectMessageComposer {...props} />;
}

function DirectMessageComposer({
  attachment,
  disabled,
  editMode,
  emojiPickerOpen,
  isRecording,
  isSavingEdit,
  notice,
  onCancelEdit,
  onCancelRecording,
  onChange,
  onEmojiSelect,
  onEmojiToggle,
  onFileAttachment,
  onMediaAttachment,
  onCancelReply,
  onRemoveAttachment,
  onSend,
  onSendRecording,
  onStartRecording,
  placeholder,
  recordingDuration,
  replyTo,
  typingUser,
  value
}: DirectMessageComposerProps) {
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const isEditing = Boolean(editMode);
  const hasSubmittableAttachment = !isEditing && Boolean(attachment);
  const sendOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    onSend();
  };

  return (
    <>
      {notice ? <div className="mb-3 rounded-xl border border-white/10 bg-[#152035] px-3 py-2 text-sm font-semibold text-[#9AA3B8]">{notice}</div> : null}
      {emojiPickerOpen && !isEditing ? (
        <div className="cs-scale-in absolute bottom-[78px] left-3 z-20 overflow-hidden rounded-2xl border border-white/10 bg-[#0E1726] shadow-2xl sm:left-5">
          <EmojiPicker height={390} onEmojiClick={onEmojiSelect} previewConfig={{ showPreview: false }} searchDisabled={false} skinTonesDisabled theme={Theme.DARK} width={340} />
        </div>
      ) : null}
      {isEditing ? <ComposerEditPreview body={editMode?.originalBody} onCancel={onCancelEdit} /> : <ComposerReplyPreview reply={replyTo} onCancel={onCancelReply} />}
      {attachment && !isEditing ? (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-white/10 bg-[#152035] px-3 py-2 text-sm text-[#E5E7EB]">
          <div className="min-w-0 truncate">
            <span className="font-bold text-[#38BDF8]">{attachment.kind.toUpperCase()}</span> {attachment.name}
          </div>
          <button className="ml-3 text-[#9AA3B8] hover:text-white" onClick={onRemoveAttachment} type="button">Remove</button>
        </div>
      ) : null}
      {typingUser ? (
        <div className="mb-2 text-xs font-bold text-[#38BDF8] cs-fade-up">
          {typingUser} is typing...
        </div>
      ) : null}
      {isRecording ? (
        <div className="flex w-full items-center justify-between rounded-2xl border border-red-500/30 bg-red-950/40 p-2 shadow-sm focus-within:border-red-400 sm:gap-3">
          <div className="flex items-center gap-2 px-3 text-sm font-bold text-red-400 animate-pulse">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500"></span>
            <span>Recording: {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, "0")}</span>
          </div>
          <div className="flex gap-2">
            <button
              aria-label="Cancel recording"
              className="cs-press rounded-xl px-3 py-2 text-sm font-bold text-[#9AA3B8] hover:bg-white/10 hover:text-white"
              onClick={onCancelRecording}
              type="button"
            >
              Cancel
            </button>
            <button
              aria-label="Send voice message"
              className="cs-press flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-black text-white hover:bg-red-500 shadow-sm"
              onClick={onSendRecording}
              type="button"
            >
              <span>Send</span>
              <Send size={15} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex w-full items-center gap-2 rounded-2xl border border-white/10 bg-[#152035]/70 p-2 shadow-sm focus-within:border-[#38BDF8] focus-within:bg-[#152035] sm:gap-3 transition">
          {!isEditing ? <button aria-label="Emoji" className={`cs-press grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ${emojiPickerOpen ? "bg-[#38BDF8]/20 text-[#38BDF8]" : "text-[#9AA3B8] hover:bg-white/10 hover:text-white"}`} onClick={onEmojiToggle} type="button">
            <Smile size={22} />
          </button> : null}
          {!isEditing ? <button
            type="button"
            aria-label="Attach image or video"
            className="cs-press grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#9AA3B8] hover:bg-white/10 hover:text-white transition"
            onClick={() => mediaInputRef.current?.click()}
          >
            <Image size={22} />
          </button> : null}
          {!isEditing ? <input
            type="file"
            accept="image/*,video/*"
            className="hidden"
            ref={mediaInputRef}
            onChange={(event) => {
              if (event.target.files?.[0]) {
                onMediaAttachment(event.target.files[0]);
                event.target.value = "";
              }
            }}
          /> : null}
          {!isEditing ? <label aria-label="Attach file" className="cs-press grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl text-[#9AA3B8] hover:bg-white/10 hover:text-white transition">
            <Paperclip size={22} />
            <input
              accept={FILE_ACCEPT}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onFileAttachment(file);
              }}
              type="file"
            />
          </label> : null}
          <input
            className="h-11 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm text-[#E5E7EB] outline-none placeholder:text-[#64748B] sm:px-2"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={sendOnEnter}
            placeholder={placeholder}
            value={value}
            disabled={disabled}
          />
          {!isEditing && !value.trim() && !attachment && !disabled ? (
            <button
              aria-label="Record voice message"
              className="cs-press grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#9AA3B8] hover:bg-white/10 hover:text-white transition"
              onClick={onStartRecording}
              type="button"
            >
              <Mic size={22} />
            </button>
          ) : null}
          <button aria-label={isEditing ? "Save edit" : "Send"} className="cs-press flex h-11 shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-[#38BDF8] to-[#60A5FA] px-4 text-sm font-bold text-[#071019] shadow-[0_4px_14px_rgba(56,189,248,0.25)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 sm:px-5 transition" disabled={disabled || isSavingEdit || (!value.trim() && !hasSubmittableAttachment)} onClick={onSend}>
            <span className="hidden sm:inline">{isEditing ? (isSavingEdit ? "Saving..." : "Save") : "Send"}</span>
            <Send size={18} />
          </button>
        </div>
      )}
    </>
  );
}

function GroupMessageComposer({
  attachmentFile,
  attachmentPreview,
  editMode,
  isRecording,
  isSending,
  isSavingEdit,
  onAttachment,
  onChange,
  onCancelEdit,
  onCancelReply,
  onRemoveAttachment,
  onSend,
  onStartRecording,
  onStopRecording,
  replyTo,
  value
}: GroupMessageComposerProps) {
  const isEditing = Boolean(editMode);
  const hasSubmittableAttachment = !isEditing && Boolean(attachmentFile);
  const sendOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <form className="border-t border-white/10 bg-[#0E1726] p-3 sm:p-4" onSubmit={onSend}>
      {isEditing ? <ComposerEditPreview body={editMode?.originalBody} onCancel={onCancelEdit} /> : <ComposerReplyPreview reply={replyTo} onCancel={onCancelReply} />}
      {attachmentFile && !isEditing ? (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-[#152035] px-3 py-2 text-sm font-bold text-[#E5E7EB]">
          {attachmentPreview ? <img alt="Attachment preview" className="h-10 w-10 rounded-lg object-cover" src={attachmentPreview} /> : <span>{attachmentFile.name}</span>}
          <button className="text-[#9AA3B8] hover:text-white" onClick={onRemoveAttachment} type="button">Remove</button>
        </div>
      ) : null}
      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#152035]/70 p-2 focus-within:border-[#38BDF8] focus-within:bg-[#152035] transition">
        {!isEditing ? <label aria-label="Attach group media" className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl text-[#9AA3B8] hover:bg-white/10 hover:text-white transition">
          <Paperclip size={20} />
          <input
            accept={FILE_ACCEPT}
            className="hidden"
            onChange={(event) => {
              onAttachment(event.target.files?.[0]);
              event.target.value = "";
            }}
            type="file"
          />
        </label> : null}
        {isRecording ? (
          <button aria-label="Stop recording" className="flex h-10 flex-1 items-center gap-2 px-2 text-sm font-bold text-red-400" onClick={onStopRecording} type="button">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />Recording... Click to stop
          </button>
        ) : (
          <input
            className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm text-[#E5E7EB] outline-none placeholder:text-[#64748B]"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={sendOnEnter}
            placeholder="Write a group message"
            value={value}
          />
        )}
        {!isEditing && !value.trim() && !attachmentFile && !isRecording ? (
          <button aria-label="Record voice message" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#9AA3B8] hover:bg-white/10 hover:text-white transition" onClick={onStartRecording} type="button">
            <Mic size={20} />
          </button>
        ) : null}
        <button aria-label={isEditing ? "Save group message edit" : "Send group message"} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-r from-[#38BDF8] to-[#60A5FA] text-[#071019] shadow-[0_4px_14px_rgba(56,189,248,0.25)] hover:brightness-110 disabled:opacity-40 transition" disabled={isSending || isSavingEdit || (!value.trim() && !hasSubmittableAttachment)} type="submit">
          <Send size={17} />
        </button>
      </div>
    </form>
  );
}
