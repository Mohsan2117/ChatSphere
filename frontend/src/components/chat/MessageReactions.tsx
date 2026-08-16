"use client";

import { Smile } from "lucide-react";

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export type ReactionUser = { id: string; name: string };
export type ReactionSummary = { emoji: string; count: number; reactedByMe?: boolean; users?: ReactionUser[] };
export type ReactionTarget = { type: "direct" | "group"; messageId: string; groupId?: string };

export function MessageReactions({
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
