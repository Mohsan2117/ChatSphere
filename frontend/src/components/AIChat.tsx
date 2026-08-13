"use client";

import { Dispatch, FormEvent, KeyboardEvent, SetStateAction, useRef } from "react";
import { Bot, Loader2, Send, X } from "lucide-react";

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
    <div className="flex h-full flex-col bg-[#f7f9fb]">
      {/* Header */}
      <header className="flex min-h-[80px] shrink-0 items-center justify-between gap-3 border-b border-[#e5e9f0] bg-white px-4 sm:px-8">
        <div className="flex items-center gap-3.5">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-[#7c3aed] to-[#3b82f6] text-white shadow-[0_8px_22px_rgba(124,58,237,.35)]">
            <Bot size={22} />
          </span>
          <div>
            <h2 className="text-xl font-black tracking-normal text-[#111827]">AI Assistant</h2>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-[#64748b]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {isLoading ? "Thinking..." : "Online"}
            </p>
          </div>
        </div>
        {onClose ? (
          <button
            aria-label="Close AI Assistant"
            className="cs-press grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#64748b] transition hover:bg-[#f1f5f9] hover:text-[#18212f]"
            onClick={onClose}
            type="button"
          >
            <X size={22} />
          </button>
        ) : null}
      </header>

      {/* Messages area */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8">
        <div className="space-y-8">
          {messages.map((msg) => (
            <div key={msg.id} className={`cs-message-in flex w-full items-end gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" ? (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#7c3aed] to-[#3b82f6] text-white shadow-[0_4px_14px_rgba(124,58,237,.3)]">
                  <Bot size={17} />
                </span>
              ) : null}
              <div
                className={`max-w-[80%] px-4 py-3 text-sm leading-7 sm:max-w-[70%] ${
                  msg.role === "user"
                    ? "rounded-2xl rounded-br-md border border-[#7c3aed]/15 bg-gradient-to-br from-[#8b5cf6]/10 to-[#3b82f6]/10 text-[#111827]"
                    : msg.error
                      ? "rounded-2xl rounded-bl-md border border-amber-200 bg-amber-50 text-amber-800"
                      : "rounded-2xl rounded-bl-md border border-[#e5e9f0] bg-white text-[#111827] shadow-[0_1px_3px_rgba(15,23,42,.06)]"
                }`}
              >
                {msg.content}
              </div>
              {msg.role === "user" ? (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#111827] text-xs font-black text-white">
                  You
                </span>
              ) : null}
            </div>
          ))}
          {isLoading ? (
            <div className="cs-message-in flex w-full items-end gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#7c3aed] to-[#3b82f6] text-white shadow-[0_4px_14px_rgba(124,58,237,.3)]">
                <Bot size={17} />
              </span>
              <div className="max-w-[80%] rounded-2xl rounded-bl-md border border-[#e5e9f0] bg-white px-4 py-3 shadow-[0_1px_3px_rgba(15,23,42,.06)] sm:max-w-[70%]">
                <div className="flex items-center gap-2 text-sm text-[#64748b]">
                  <Loader2 className="animate-spin" size={16} />
                  Thinking...
                </div>
              </div>
            </div>
          ) : null}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Composer */}
      <footer className="shrink-0 border-t border-[#e5e9f0] bg-white/85 px-4 py-4 backdrop-blur sm:px-8">
        {error ? <div className="mx-auto mb-3 max-w-3xl rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700">{error}</div> : null}
        <form className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-3xl border border-[#e2e6ed] bg-white p-2 shadow-[0_8px_30px_rgba(15,23,42,.08)] focus-within:border-[#8b5cf6]/40" onSubmit={sendMessage}>
          <input
            className="h-10 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none focus-visible:!outline-none placeholder:text-[#94a3b8] sm:px-2"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the AI assistant..."
            value={input}
            disabled={isLoading}
          />
          <button
            aria-label="Send"
            className="cs-press flex h-10 shrink-0 items-center justify-center gap-1 rounded-full bg-gradient-to-r from-[#7c3aed] to-[#3b82f6] px-4 text-sm font-black text-white shadow-[0_6px_18px_rgba(124,58,237,.35)] transition disabled:cursor-not-allowed disabled:opacity-50 sm:px-5"
            disabled={isLoading || !input.trim()}
            type="submit"
          >
            <Send size={16} />
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>
        <p className="mx-auto mt-3 max-w-3xl text-center text-xs text-[#94a3b8]">
          ChatSphere AI can make mistakes. Consider checking important information.
        </p>
      </footer>
    </div>
  );
}