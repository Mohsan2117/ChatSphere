"use client";

import {
  Bell,
  Camera,
  Check,
  ChevronDown,
  MoreHorizontal,
  Paperclip,
  Phone,
  Plus,
  Search,
  Send,
  Settings,
  Shield,
  Smile,
  UserPlus,
  Video
} from "lucide-react";
import { chats, contacts, events, health, messages, modules } from "@/lib/data";

export function AppShell() {
  return (
    <main className="min-h-screen px-4 py-4 text-ink sm:px-6 lg:px-8">
      <section className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[320px_minmax(0,1fr)_300px]">
        <aside className="overflow-hidden rounded-lg border border-black/5 bg-white shadow-panel">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
            <div>
              <h1 className="text-2xl font-bold tracking-normal">ChatSphere</h1>
              <p className="mt-1 text-sm text-slate-500">Secure realtime messaging</p>
            </div>
            <button aria-label="Open settings" className="grid h-10 w-10 place-items-center rounded-md bg-mist text-lagoon">
              <Settings size={19} />
            </button>
          </div>

          <div className="p-4">
            <label className="flex h-11 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
              <Search size={17} />
              <input className="w-full bg-transparent text-ink outline-none" placeholder="Search chats, users, messages" />
            </label>
          </div>

          <div className="space-y-1 px-2 pb-3">
            {chats.map((chat) => (
              <button key={chat.id} className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-mist">
                <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-md bg-lagoon font-bold text-white">
                  {chat.avatar}
                  {chat.online ? <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <strong className="truncate text-sm">{chat.name}</strong>
                    <span className="text-xs text-slate-400">{chat.time}</span>
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-500">{chat.preview}</span>
                    {chat.unread ? <span className="rounded-full bg-coral px-2 py-0.5 text-xs font-bold text-white">{chat.unread}</span> : null}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="overflow-hidden rounded-lg border border-black/5 bg-white shadow-panel">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-md bg-ink font-bold text-white">MC</div>
              <div>
                <h2 className="text-lg font-bold">Maya Chen</h2>
                <p className="text-sm text-emerald-600">Online • typing secure messages</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {[Phone, Video, Search, MoreHorizontal].map((Icon, index) => (
                <button key={index} className="grid h-10 w-10 place-items-center rounded-md bg-slate-50 text-slate-600 hover:bg-mist" aria-label="Conversation action">
                  <Icon size={18} />
                </button>
              ))}
            </div>
          </header>

          <div className="flex min-h-[560px] flex-col bg-[linear-gradient(180deg,#f8fbfa,#ffffff)]">
            <div className="flex-1 space-y-4 overflow-hidden p-4 sm:p-6">
              <div className="mx-auto w-fit rounded-full bg-mist px-3 py-1 text-xs font-semibold text-lagoon">Today</div>
              {messages.map((message) => (
                <div key={message.id} className={`flex ${message.mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[78%] rounded-lg px-4 py-3 shadow-sm ${message.mine ? "bg-lagoon text-white" : "bg-white text-ink ring-1 ring-slate-100"}`}>
                    <div className="text-sm leading-6">{message.body}</div>
                    <div className={`mt-2 flex items-center justify-end gap-1 text-xs ${message.mine ? "text-white/75" : "text-slate-400"}`}>
                      {message.time}
                      {message.mine ? <Check size={14} /> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-100 bg-white p-4">
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <button aria-label="Add emoji" className="grid h-10 w-10 place-items-center rounded-md text-slate-500 hover:bg-white">
                  <Smile size={19} />
                </button>
                <button aria-label="Attach file" className="grid h-10 w-10 place-items-center rounded-md text-slate-500 hover:bg-white">
                  <Paperclip size={19} />
                </button>
                <input className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none" placeholder="Write a message" />
                <button aria-label="Open camera" className="grid h-10 w-10 place-items-center rounded-md text-slate-500 hover:bg-white">
                  <Camera size={19} />
                </button>
                <button aria-label="Send message" className="grid h-10 w-10 place-items-center rounded-md bg-lagoon text-white">
                  <Send size={18} />
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-black/5 bg-white p-4 shadow-panel">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">Platform Modules</h2>
              <button aria-label="Add module" className="grid h-9 w-9 place-items-center rounded-md bg-mist text-lagoon">
                <Plus size={18} />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {modules.map((item) => (
                <div key={item.label} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                  <item.icon className="text-lagoon" size={18} />
                  <div className="mt-3 text-sm font-bold">{item.label}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.value}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-black/5 bg-white p-4 shadow-panel">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">Realtime Events</h2>
              <ChevronDown size={18} className="text-slate-400" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {events.map((event) => (
                <span key={event} className="rounded-md bg-mist px-2.5 py-1 text-xs font-semibold text-lagoon">
                  {event}
                </span>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-black/5 bg-white p-4 shadow-panel">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">Contacts</h2>
              <UserPlus size={18} className="text-lagoon" />
            </div>
            <div className="mt-3 space-y-3">
              {contacts.map((contact) => (
                <div key={contact.name} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold">{contact.name}</div>
                    <div className="text-xs text-slate-500">{contact.meta}</div>
                  </div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">{contact.status}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-black/5 bg-ink p-4 text-white shadow-panel">
            <div className="flex items-center gap-2">
              <Shield size={18} className="text-gold" />
              <h2 className="font-bold">System Readiness</h2>
            </div>
            <div className="mt-4 space-y-3">
              {health.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-white/70">{item.label}</span>
                  <strong className={item.state === "ready" ? "text-gold" : "text-white"}>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-black/5 bg-white p-4 shadow-panel">
            <div className="flex items-center gap-2">
              <Bell size={18} className="text-coral" />
              <h2 className="font-bold">Notifications</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              In-app notifications are modeled now; push delivery can be added after production auth and device tokens are enabled.
            </p>
          </section>
        </aside>
      </section>
    </main>
  );
}
