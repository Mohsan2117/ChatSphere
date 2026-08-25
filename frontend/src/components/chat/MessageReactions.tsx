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
        className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-[#152035] text-[#9AA3B8] shadow-sm transition hover:border-[#38BDF8]/40 hover:text-[#38BDF8]"
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
          className={`inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs font-bold transition ${
            reaction.reactedByMe ? "border-[#38BDF8]/40 bg-[#38BDF8]/15 text-[#38BDF8]" : "border-white/10 bg-[#152035] text-[#E5E7EB] hover:border-white/20"
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
        <div className={`absolute bottom-9 z-40 flex gap-1 rounded-full border border-white/10 bg-[#0E1726] p-1 shadow-[0_14px_35px_rgba(0,0,0,0.6)] backdrop-blur-xl ${align === "right" ? "right-0" : "left-0"}`}>
          {REACTION_EMOJIS.map((emoji) => (
            <button
              className="grid h-9 w-9 place-items-center rounded-full text-lg transition hover:bg-white/10"
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
