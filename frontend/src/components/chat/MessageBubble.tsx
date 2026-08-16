"use client";

import { ChangeEvent, MouseEvent, ReactNode, TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, FileText, Pause, Play } from "lucide-react";
import { MessageReactions, type ReactionSummary, type ReactionTarget, type ReactionUser } from "./MessageReactions";

export type BubbleAttachment = {
  name: string;
  type: string;
  url: string;
  kind: "image" | "video" | "file" | "audio";
};

export type BubbleMessage = {
  id: string;
  body: string;
  time?: string;
  mine?: boolean;
  createdAt?: string;
  readAt?: string | null;
  attachment?: BubbleAttachment;
  status?: "uploading" | "sending" | "sent" | "failed";
  progressMsg?: string;
  reactions?: ReactionSummary[];
};

type MessageBubbleProps<TMessage extends BubbleMessage> = {
  authToken: string;
  isOwn?: boolean;
  message: TMessage;
  onOpenReactionDetails: (details: { emoji: string; users: ReactionUser[] }) => void;
  onReact: (target: ReactionTarget, emoji: string) => void;
  onRetry?: (message: TMessage) => void;
  reactionPicker: ReactionTarget | null;
  reactionTarget: ReactionTarget;
  resolveAttachmentSource: (url: string, token: string) => string;
  selectedChatOnline?: boolean;
  senderName?: string;
  setReactionPicker: (target: ReactionTarget | null) => void;
  timestamp: ReactNode;
  variant: "direct" | "group";
};

export function MessageBubble<TMessage extends BubbleMessage>({
  authToken,
  isOwn,
  message,
  onOpenReactionDetails,
  onReact,
  onRetry,
  reactionPicker,
  reactionTarget,
  resolveAttachmentSource,
  selectedChatOnline,
  senderName,
  setReactionPicker,
  timestamp,
  variant
}: MessageBubbleProps<TMessage>) {
  const own = isOwn ?? Boolean(message.mine);
  const isDirect = variant === "direct";
  const outerClass = isDirect
    ? `cs-message-in flex ${own ? "justify-end" : "justify-start"}`
    : `flex w-full min-w-0 items-start ${own ? "justify-end" : "justify-start"}`;
  const innerClass = isDirect
    ? `flex max-w-[72%] flex-col ${own ? "items-end" : "items-start"}`
    : `flex min-w-0 max-w-[78%] flex-col ${own ? "items-end" : "items-start"}`;
  const bubbleClass = isDirect
    ? `max-w-full rounded-2xl border px-4 py-3 shadow-sm ${own ? "border-[#00a884]/20 bg-[#dff8ef]" : "border-[#e5e9f0] bg-white"}`
    : `min-w-0 max-w-full rounded-2xl border px-4 py-3 shadow-sm ${own ? "border-[#00a884]/20 bg-[#dff8ef]" : "border-[#e5e9f0] bg-white"}`;

  return (
    <div className={outerClass}>
      <div className={innerClass}>
        {isDirect && message.attachment?.kind === "audio" ? (
          <VoiceMessageBubble
            authToken={authToken}
            message={message}
            onRetry={onRetry}
            resolveAttachmentSource={resolveAttachmentSource}
            selectedChatOnline={selectedChatOnline}
            timestamp={timestamp}
          />
        ) : (
          <div className={bubbleClass}>
            {!isDirect && !own && senderName ? <div className="mb-1 text-xs font-black text-[#008f70]">{senderName}</div> : null}
            {message.attachment ? <AttachmentPreview attachment={message.attachment} authToken={authToken} resolveAttachmentSource={resolveAttachmentSource} /> : null}
            {message.body ? <p className="text-sm leading-6 text-[#18212f]">{message.body}</p> : null}
            {isDirect ? (
              <DirectMessageMeta message={message} onRetry={onRetry} selectedChatOnline={selectedChatOnline} timestamp={timestamp} />
            ) : (
              <div className="mt-2 text-right text-[11px] font-semibold text-[#94a3b8]">{timestamp}</div>
            )}
          </div>
        )}
        <MessageReactions
          align={own ? "right" : "left"}
          onReact={onReact}
          onShowDetails={onOpenReactionDetails}
          pickerTarget={reactionPicker}
          reactions={message.reactions}
          setPickerTarget={setReactionPicker}
          target={reactionTarget}
        />
      </div>
    </div>
  );
}

function DirectMessageMeta<TMessage extends BubbleMessage>({
  message,
  onRetry,
  selectedChatOnline,
  timestamp
}: {
  message: TMessage;
  onRetry?: (message: TMessage) => void;
  selectedChatOnline?: boolean;
  timestamp: ReactNode;
}) {
  return (
    <div className="mt-2 flex justify-end gap-1 text-xs font-semibold text-[#94a3b8]">
      {timestamp}
      {message.mine ? (
        <div className="flex items-center gap-1">
          {message.status === "uploading" ? (
            <span>{message.progressMsg || "Uploading..."}</span>
          ) : message.status === "sending" ? (
            <span>{message.progressMsg || "Sending..."}</span>
          ) : message.status === "failed" ? (
            <span className="text-[#b42318] flex items-center gap-1">
              <span>{message.progressMsg || "⚠ Failed"}</span>
              {onRetry ? (
                <button
                  className="underline font-bold text-sky-600 hover:text-sky-800 ml-1 cursor-pointer focus:outline-none"
                  onClick={() => onRetry(message)}
                  type="button"
                >
                  Retry
                </button>
              ) : null}
            </span>
          ) : (
            <>
              <span>{message.readAt ? "Seen" : "Sent"}</span>
              {message.readAt ? (
                <CheckCheck size={15} className="text-[#00a884]" />
              ) : selectedChatOnline ? (
                <CheckCheck size={15} className="text-[#94a3b8]" />
              ) : (
                <Check size={15} className="text-[#94a3b8]" />
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AttachmentPreview({
  attachment,
  authToken,
  resolveAttachmentSource
}: {
  attachment: BubbleAttachment;
  authToken: string;
  resolveAttachmentSource: (url: string, token: string) => string;
}) {
  const [failed, setFailed] = useState(false);
  const source = resolveAttachmentSource(attachment.url, authToken);
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

  const handleSliderChange = (e: ChangeEvent<HTMLInputElement>) => {
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
    return peaks.map((p) => Math.max(0.15, p / maxPeak));
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

function VoiceMessageBubble<TMessage extends BubbleMessage>({
  authToken,
  message,
  onRetry,
  resolveAttachmentSource,
  selectedChatOnline,
  timestamp
}: {
  authToken: string;
  message: TMessage;
  onRetry?: (message: TMessage) => void;
  resolveAttachmentSource: (url: string, token: string) => string;
  selectedChatOnline?: boolean;
  timestamp: ReactNode;
}) {
  const attachment = message.attachment!;
  const [failed, setFailed] = useState(false);
  const source = resolveAttachmentSource(attachment.url, authToken);
  const canPreview = Boolean(source && /^(https?:|data:|blob:)/i.test(source) && !failed);

  if (!canPreview) {
    return (
      <div className={`max-w-[72%] rounded-2xl border px-4 py-3 shadow-sm ${message.mine ? "border-[#00a884]/20 bg-[#dff8ef]" : "border-[#e5e9f0] bg-white"}`}>
        <a className="flex items-center gap-3 rounded-md border border-[#dce1e8] bg-white/70 px-3 py-3 text-sm font-bold text-[#334155]" href={source || undefined} download={attachment.name}>
          <FileText size={20} />
          <span className="min-w-0 truncate">{attachment.name}</span>
        </a>
        <DirectMessageMeta message={message} onRetry={onRetry} selectedChatOnline={selectedChatOnline} timestamp={timestamp} />
      </div>
    );
  }

  return (
    <VoiceMessagePlayer
      source={source}
      name={attachment.name}
      message={message}
      selectedChatOnline={selectedChatOnline}
      onRetry={onRetry}
      timestamp={timestamp}
    />
  );
}

function VoiceMessagePlayer<TMessage extends BubbleMessage>({
  source,
  name,
  message,
  selectedChatOnline,
  onRetry,
  timestamp
}: {
  source: string;
  name: string;
  message: TMessage;
  selectedChatOnline?: boolean;
  onRetry?: (message: TMessage) => void;
  timestamp: ReactNode;
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

  const handleWaveformClick = (e: MouseEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    handleSeek(ratio);
  };

  const handleWaveformTouch = (e: TouchEvent<HTMLDivElement>) => {
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

        <div className="flex justify-between items-center text-[10px] sm:text-[11px] font-medium text-[#64748b] mt-1 select-none">
          <span>{formatTime(displayTime)}</span>
          <div className="flex items-center gap-1">
            <span>{timestamp}</span>
            {message.mine && (
              <div className="flex items-center gap-1">
                {message.status === "uploading" ? (
                  <span>{message.progressMsg || "Uploading..."}</span>
                ) : message.status === "sending" ? (
                  <span>{message.progressMsg || "Sending..."}</span>
                ) : message.status === "failed" ? (
                  <span className="text-[#b42318] flex items-center gap-1">
                    <span>{message.progressMsg || "⚠ Failed"}</span>
                    {onRetry ? (
                      <button
                        onClick={() => onRetry(message)}
                        className="underline font-bold text-sky-600 hover:text-sky-800 ml-1 cursor-pointer focus:outline-none"
                        type="button"
                      >
                        Retry
                      </button>
                    ) : null}
                  </span>
                ) : (
                  <>
                    <span>{message.readAt ? "Seen" : "Sent"}</span>
                    {message.readAt ? (
                      <CheckCheck size={14} className="text-[#00a884]" />
                    ) : selectedChatOnline ? (
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
