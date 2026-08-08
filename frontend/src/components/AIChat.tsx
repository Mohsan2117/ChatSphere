"use client";

import { FormEvent, KeyboardEvent, useRef, useState } from "react";
import { Bot, Loader2, Send, User, X } from "lucide-react";

type AIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
};

type AIChatProps = {
  apiUrl: string;
  authToken: string;
  onClose: () => void;
};

export function AIChat({ apiUrl, authToken, onClose }: AIChatProps) {
  const [messages, setMessages] = useState<AIMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hello! I'm your AI assistant. Ask me anything!"
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
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
      <header className="flex min-h-[82px] items-center justify-between border-b border-[#e5e9f0] bg-white px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-[#00a884] to-[#0f766e] text-white">
            <Bot size={24} />
          </span>
          <div>
            <h2 className="text-xl font-black">AI Assistant</h2>
            <p className="text-sm font-semibold text-[#00a884]">{isLoading ? "Thinking..." : "Online"}</p>
          </div>
        </div>
        <button
          aria-label="Close AI assistant"
          className="cs-press grid h-10 w-10 place-items-center rounded-xl text-[#64748b] hover:bg-[#f1f5f9]"
          onClick={onClose}
          type="button"
        >
          <X size={22} />
        </button>
      </header>

      {/* Messages area */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 pb-28 sm:px-6 sm:pb-32">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className={`cs-message-in flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl border px-4 py-3 shadow-sm ${
                  msg.role === "user"
                    ? "border-[#00a884]/20 bg-[#dff8ef]"
                    : msg.error
                      ? "border-amber-200 bg-amber-50"
                      : "border-[#e5e9f0] bg-white"
                }`}
              >
                <div className="mb-1 flex items-center gap-2 text-xs font-bold text-[#94a3b8]">
                  {msg.role === "user" ? (
                    <>
                      <User size={13} /> You
                    </>
                  ) : (
                    <>
                      <Bot size={13} /> AI
                    </>
                  )}
                </div>
                <p className={`text-sm leading-6 ${msg.error ? "text-amber-800" : "text-[#18212f]"}`}>{msg.content}</p>
              </div>
            </div>
          ))}
          {isLoading ? (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl border border-[#e5e9f0] bg-white px-4 py-3 shadow-sm">
                <div className="mb-1 flex items-center gap-2 text-xs font-bold text-[#94a3b8]">
                  <Bot size={13} /> AI
                </div>
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

      {/* Input area */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#e5e9f0] bg-white px-3 py-3 shadow-[0_-14px_35px_rgba(15,23,42,.08)] sm:px-5">
        {error ? <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div> : null}
        <form className="flex w-full items-center gap-2" onSubmit={sendMessage}>
          <input
            className="h-11 min-w-0 flex-1 rounded-xl border border-[#dce1e8] bg-[#f8fafc] px-4 text-sm outline-none placeholder:text-[#94a3b8] focus:border-[#00a884] focus:bg-white"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the AI assistant..."
            value={input}
            disabled={isLoading}
          />
          <button
            aria-label="Send"
            className="cs-press flex h-11 shrink-0 items-center gap-2 rounded-xl bg-[#00a884] px-4 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 sm:px-5"
            disabled={isLoading || !input.trim()}
            type="submit"
          >
            <span className="hidden sm:inline">Send</span>
            <Send size={18} />
          </button>
        </form>
      </footer>
    </div>
  );
}