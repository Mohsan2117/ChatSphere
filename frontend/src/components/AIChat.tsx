"use client";

import { Dispatch, FormEvent, KeyboardEvent, SetStateAction, useEffect, useRef } from "react";
import { Bot, Loader2, Send, Trash2, X } from "lucide-react";

export type AIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
};

type AIChatProps = {
  apiUrl: string;
  authToken: string;
  onClose?: () => void;
  onUnauthorized?: () => void;
  messages: AIMessage[];
  setMessages: Dispatch<SetStateAction<AIMessage[]>>;
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  setIsLoading: (value: boolean) => void;
  error: string;
  setError: (value: string) => void;
};

export function AIChat({
  apiUrl,
  authToken,
  onClose,
  onUnauthorized,
  messages,
  setMessages,
  input,
  setInput,
  isLoading,
  setIsLoading,
  error,
  setError
}: AIChatProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    window.setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  }

  // Load chat history from backend database on mount
  useEffect(() => {
    if (!authToken) return;
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/ai/messages`, {
      headers: {
        Authorization: `Bearer ${authToken}`
      }
    })
      .then((res) => {
        if (res.status === 401) {
          onUnauthorized?.();
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.messages)) return;
        if (data.messages.length > 0) {
          setMessages(
            data.messages.map((m: any) => ({
              id: m.id || `msg-${Date.now()}-${Math.random()}`,
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content || ""
            }))
          );
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [apiUrl, authToken, onUnauthorized, setMessages]);

  async function clearHistory() {
    if (!confirm("Are you sure you want to clear AI chat history?")) return;
    try {
      const res = await fetch(`${apiUrl}/api/v1/ai/messages`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });
      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }
      setMessages([]);
    } catch {}
  }

  async function sendMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;

    setInput("");
    setError("");

    const userMessage: AIMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    scrollToBottom();

    try {
      const response = await fetch(`${apiUrl}/api/v1/ai/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ message: text })
      });

      if (response.status === 401) {
        onUnauthorized?.();
        return;
      }

      const data = await response.json().catch(() => ({}));

      if (response.status === 429) {
        const errorText = (data.error as string) ?? "";
        const isDaily = errorText.includes("Daily AI limit");
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: isDaily
              ? "You've reached your daily AI limit. Please try again tomorrow."
              : "AI usage limit reached. Please try again later.",
            error: true
          }
        ]);
        return;
      }

      if (!response.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: "The AI assistant is temporarily unavailable. Please try again later.",
            error: true
          }
        ]);
        return;
      }

      const reply = (data.response as string) ?? "I'm not sure how to respond to that.";
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: reply
        }
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: "The AI assistant is temporarily unavailable. Please try again later.",
          error: true
        }
      ]);
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#071019] text-[#E5E7EB]">
      {/* Header */}
      <header className="flex min-h-[80px] shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#0E1726] px-4 sm:px-8">
        <div className="flex items-center gap-3.5">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-[#38BDF8] to-[#60A5FA] text-[#071019] shadow-[0_8px_22px_rgba(56,189,248,.35)]">
            <Bot size={22} />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-normal text-[#E5E7EB]">AI Assistant</h2>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-[#9AA3B8]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#38BDF8] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#38BDF8]" />
              </span>
              {isLoading ? "Thinking..." : "Online"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 ? (
            <button
              aria-label="Clear chat history"
              title="Clear chat history"
              className="cs-press grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#9AA3B8] transition hover:bg-white/10 hover:text-red-400"
              onClick={clearHistory}
              type="button"
            >
              <Trash2 size={19} />
            </button>
          ) : null}
          {onClose ? (
            <button
              aria-label="Close AI Assistant"
              className="cs-press grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#9AA3B8] transition hover:bg-white/10 hover:text-white"
              onClick={onClose}
              type="button"
            >
              <X size={22} />
            </button>
          ) : null}
        </div>
      </header>

      {/* Messages area */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8 bg-[#071019]">
        <div className="space-y-8">
          {messages.map((msg) => (
            <div key={msg.id} className={`cs-message-in flex w-full items-end gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" ? (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#38BDF8] to-[#60A5FA] text-[#071019] shadow-[0_4px_14px_rgba(56,189,248,.3)]">
                  <Bot size={17} />
                </span>
              ) : null}
              <div
                className={`max-w-[80%] px-4 py-3 text-sm leading-7 sm:max-w-[70%] ${
                  msg.role === "user"
                    ? "rounded-2xl rounded-br-md border border-[#38BDF8]/25 bg-[#0B3B60] text-white"
                    : msg.error
                      ? "rounded-2xl rounded-bl-md border border-red-500/30 bg-red-950/40 text-red-300"
                      : "rounded-2xl rounded-bl-md border border-white/10 bg-[#152035] text-[#E5E7EB] shadow-[0_1px_3px_rgba(0,0,0,0.4)]"
                }`}
              >
                {msg.content}
              </div>
              {msg.role === "user" ? (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#152035] border border-white/10 text-xs font-bold text-[#E5E7EB]">
                  You
                </span>
              ) : null}
            </div>
          ))}
          {isLoading ? (
            <div className="cs-message-in flex w-full items-end gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#38BDF8] to-[#60A5FA] text-[#071019] shadow-[0_4px_14px_rgba(56,189,248,.3)]">
                <Bot size={17} />
              </span>
              <div className="max-w-[80%] rounded-2xl rounded-bl-md border border-white/10 bg-[#152035] px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.4)] sm:max-w-[70%]">
                <div className="flex items-center gap-2 text-sm text-[#9AA3B8]">
                  <Loader2 className="animate-spin text-[#38BDF8]" size={16} />
                  Thinking...
                </div>
              </div>
            </div>
          ) : null}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Composer */}
      <footer className="shrink-0 border-t border-white/10 bg-[#0E1726]/95 px-4 py-4 backdrop-blur sm:px-8">
        {error ? <div className="mx-auto mb-3 max-w-3xl rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-2.5 text-sm font-semibold text-red-300">{error}</div> : null}
        <form className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-3xl border border-white/10 bg-[#152035]/70 p-2 shadow-[0_8px_30px_rgba(0,0,0,0.4)] focus-within:border-[#38BDF8]/60 transition" onSubmit={sendMessage}>
          <input
            className="h-10 min-w-0 flex-1 bg-transparent px-1 text-sm text-[#E5E7EB] outline-none focus-visible:!outline-none placeholder:text-[#64748B] sm:px-2"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the AI assistant..."
            value={input}
            disabled={isLoading}
          />
          <button
            aria-label="Send"
            className="cs-press flex h-10 shrink-0 items-center justify-center gap-1 rounded-full bg-gradient-to-r from-[#38BDF8] to-[#60A5FA] px-4 text-sm font-bold text-[#071019] shadow-[0_6px_18px_rgba(56,189,248,.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 sm:px-5"
            disabled={isLoading || !input.trim()}
            type="submit"
          >
            <Send size={16} />
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>
        <p className="mx-auto mt-3 max-w-3xl text-center text-xs text-[#64748B]">
          ChatSphere AI can make mistakes. Consider checking important information.
        </p>
      </footer>
    </div>
  );
}