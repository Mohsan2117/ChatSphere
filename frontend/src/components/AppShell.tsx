"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  CheckCheck,
  FileText,
  Image,
  Loader2,
  LogOut,
  MessageCircle,
  MoreVertical,
  Paperclip,
  Mail,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Smile,
  Upload,
  UserPlus,
  Users
} from "lucide-react";
import { chats, emptyContacts, messages } from "@/lib/data";

type AuthStep = "email" | "code" | "profile";

export function AppShell() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [authStep, setAuthStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [profileError, setProfileError] = useState("");
  const [selectedChatId, setSelectedChatId] = useState(chats[0]?.id ?? "");
  const [hasMessages] = useState(true);

  const selectedChat = useMemo(() => chats.find((chat) => chat.id === selectedChatId) ?? chats[0], [selectedChatId]);

  useEffect(() => {
    const hasVerifiedEmail = window.localStorage.getItem("chatsphere-auth") === "true";
    const hasProfile = window.localStorage.getItem("chatsphere-profile-complete") === "true";
    const savedEmail = window.localStorage.getItem("chatsphere-email");

    if (savedEmail) setEmail(savedEmail);
    setIsAuthed(hasVerifiedEmail && hasProfile);
    if (hasVerifiedEmail && !hasProfile) setAuthStep("profile");
  }, []);

  useEffect(() => {
    if (resendSeconds <= 0) return;

    const timer = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendSeconds]);

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
    await sendCode();
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
      setAuthStep("profile");
      setAuthMessage("");
      setAuthError("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Invalid code");
    } finally {
      setIsSubmitting(false);
    }
  }

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function completeProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firstName.trim()) {
      setProfileError("First name is required");
      return;
    }

    setIsSubmitting(true);
    setProfileError("");

    try {
      const formData = new FormData();
      formData.set("email", email);
      formData.set("firstName", firstName.trim());
      formData.set("lastName", lastName.trim());
      if (avatarFile) formData.set("avatar", avatarFile);

      const response = await fetch(`${apiUrl()}/api/v1/profile/onboarding`, {
        method: "POST",
        body: formData
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not save profile");

      window.localStorage.setItem("chatsphere-profile-complete", "true");
      window.localStorage.setItem(
        "chatsphere-profile",
        JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          avatarPreview
        })
      );
      setIsAuthed(true);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Could not save profile");
    } finally {
      setIsSubmitting(false);
    }
  }

  function logout() {
    window.localStorage.removeItem("chatsphere-auth");
    window.localStorage.removeItem("chatsphere-email");
    window.localStorage.removeItem("chatsphere-profile-complete");
    window.localStorage.removeItem("chatsphere-profile");
    setIsAuthed(false);
    setAuthStep("email");
    setVerificationCode("");
    setAuthMessage("");
    setAuthError("");
    setResendSeconds(0);
    setFirstName("");
    setLastName("");
    setAvatarFile(null);
    setAvatarPreview("");
    setProfileError("");
  }

  if (!isAuthed) {
    return (
      <main className="min-h-screen bg-[#0b141a] text-white">
        <section className="mx-auto grid min-h-screen max-w-6xl items-center gap-8 px-5 py-10 lg:grid-cols-[1fr_420px]">
          <div className="max-w-2xl">
            <div className="flex h-14 w-14 items-center justify-center rounded-md bg-[#00a884] text-[#0b141a]">
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

          <div className="rounded-lg border border-white/10 bg-[#111b21] p-5 shadow-2xl">
            <div className="border-b border-white/10 pb-5">
              <h2 className="text-2xl font-bold">
                {authStep === "email" ? "Login or signup" : authStep === "code" ? "Enter email code" : "Create your profile"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#aebac1]">
                {authStep === "email"
                  ? "Use your email address to create an account or sign in."
                  : authStep === "code"
                    ? `Enter the 6-digit code sent to ${email}.`
                    : "Add your name and profile photo before opening chats."}
              </p>
            </div>

            {authStep === "email" ? (
              <form className="mt-5 space-y-4" onSubmit={requestCode}>
                <label className="block">
                  <span className="text-sm font-semibold text-[#d1d7db]">Email address</span>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="mt-2 h-12 w-full rounded-md border border-white/10 bg-[#202c33] px-4 text-white outline-none placeholder:text-[#8696a0]"
                    placeholder="you@example.com"
                    inputMode="email"
                    type="email"
                  />
                </label>
                <button className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#00a884] font-bold text-[#06130f]">
                  {isSubmitting ? "Sending code..." : "Send email code"}
                  {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                </button>
                <p className="text-xs leading-5 text-[#8696a0]">
                  We will send a 6-digit login code to your inbox.
                </p>
                {authError ? <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-200">{authError}</p> : null}
              </form>
            ) : authStep === "profile" ? (
              <form className="mt-5 space-y-4" onSubmit={completeProfile}>
                <div className="flex items-center gap-4 rounded-md border border-white/10 bg-[#0b141a] p-4">
                  <label className="grid h-20 w-20 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full border border-white/10 bg-[#202c33] text-[#00a884]">
                    {avatarPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="Profile preview" className="h-full w-full object-cover" src={avatarPreview} />
                    ) : (
                      <Upload size={28} />
                    )}
                    <input accept="image/*" className="hidden" onChange={chooseAvatar} type="file" />
                  </label>
                  <div className="min-w-0">
                    <div className="font-bold text-white">Profile picture</div>
                    <div className="mt-1 text-sm leading-5 text-[#aebac1]">Upload a photo so contacts can recognize you.</div>
                  </div>
                </div>
                <label className="block">
                  <span className="text-sm font-semibold text-[#d1d7db]">First name</span>
                  <input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    className="mt-2 h-12 w-full rounded-md border border-white/10 bg-[#202c33] px-4 text-white outline-none placeholder:text-[#8696a0]"
                    placeholder="Ahsan"
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
                    className="mt-2 h-12 w-full rounded-md border border-white/10 bg-[#202c33] px-4 text-white outline-none placeholder:text-[#8696a0]"
                    placeholder="Khan"
                    type="text"
                  />
                </label>
                <button className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#00a884] font-bold text-[#06130f]">
                  {isSubmitting ? "Saving profile..." : "Done / Continue"}
                  {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <ShieldCheck size={18} />}
                </button>
                {profileError ? <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-200">{profileError}</p> : null}
              </form>
            ) : (
              <form className="mt-5 space-y-4" onSubmit={verifyCode}>
                {authMessage ? <p className="rounded-md bg-[#00a884]/10 px-3 py-2 text-sm text-[#98ffd4]">{authMessage}</p> : null}
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
                <button className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#00a884] font-bold text-[#06130f]">
                  {isSubmitting ? "Checking code..." : "Verify and continue"}
                  {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <ShieldCheck size={18} />}
                </button>
                {authError ? <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-200">{authError}</p> : null}
              </form>
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#111b21] text-[#e9edef]">
      <section className="grid min-h-screen lg:grid-cols-[505px_minmax(0,1fr)]">
        <aside className="border-r border-[#313d45] bg-[#111b21]">
          <header className="flex items-center justify-between px-7 py-7">
            <h1 className="text-3xl font-bold tracking-normal">Chats</h1>
            <div className="flex items-center gap-5 text-[#d1d7db]">
              <button aria-label="New chat" className="hover:text-white">
                <Plus size={25} />
              </button>
              <button aria-label="Logout" className="hover:text-white" onClick={logout}>
                <LogOut size={22} />
              </button>
              <button aria-label="More options" className="hover:text-white">
                <MoreVertical size={25} />
              </button>
            </div>
          </header>

          <div className="px-7">
            <label className="flex h-14 items-center gap-4 rounded-full bg-[#2a3942] px-5 text-[#aebac1]">
              <Search size={24} />
              <input className="w-full bg-transparent text-lg outline-none placeholder:text-[#aebac1]" placeholder="Search or start a new chat" />
            </label>
          </div>

          <div className="flex gap-2 px-7 py-4">
            {["All", "Unread", "Favourites"].map((filter, index) => (
              <button
                key={filter}
                className={`rounded-full border px-4 py-2 text-lg font-semibold ${
                  index === 0 ? "border-[#0b6b56] bg-[#0b3b31] text-[#98ffd4]" : "border-[#2a3942] text-[#aebac1]"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>

          <div className="h-[calc(100vh-188px)] overflow-y-auto px-3 pb-5">
            {(hasMessages ? chats : emptyContacts).map((chat) => (
              <button
                key={chat.id}
                onClick={() => setSelectedChatId(chat.id)}
                className={`flex w-full items-center gap-5 rounded-lg px-5 py-4 text-left ${
                  selectedChatId === chat.id ? "ring-2 ring-[#00a884]" : "hover:bg-[#202c33]"
                }`}
              >
                <span className={`grid h-16 w-16 shrink-0 place-items-center rounded-full ${chat.color} text-xl font-bold text-white`}>
                  {chat.avatar}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <strong className="truncate text-xl">{chat.name}</strong>
                    <span className="text-sm font-semibold text-[#aebac1]">{chat.time}</span>
                  </span>
                  <span className="mt-2 flex items-center justify-between gap-3">
                    <span className="truncate text-lg text-[#aebac1]">{chat.preview}</span>
                    {chat.unread ? <span className="rounded-full bg-[#00a884] px-2 py-0.5 text-xs font-bold text-[#06130f]">{chat.unread}</span> : null}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-h-screen flex-col bg-[#0b141a]">
          {selectedChat ? (
            <>
              <header className="flex h-[77px] items-center justify-between border-b border-[#202c33] bg-[#202c33] px-6">
                <div className="flex min-w-0 items-center gap-4">
                  <span className={`grid h-12 w-12 place-items-center rounded-full ${selectedChat.color} font-bold text-white`}>{selectedChat.avatar}</span>
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-bold">{selectedChat.name}</h2>
                    <p className="text-sm text-[#aebac1]">{selectedChat.online ? "online" : "last seen recently"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-[#d1d7db]">
                  <Search size={24} />
                  <MoreVertical size={24} />
                </div>
              </header>

              <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
                <div className="mx-auto w-fit rounded-md bg-[#182229] px-3 py-2 text-sm text-[#aebac1]">Today</div>
                {messages.map((message) => (
                  <div key={message.id} className={`flex ${message.mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[70%] rounded-md px-4 py-2 shadow ${message.mine ? "bg-[#005c4b]" : "bg-[#202c33]"}`}>
                      <p className="text-base leading-7">{message.body}</p>
                      <div className="mt-1 flex justify-end gap-1 text-xs text-[#aebac1]">
                        {message.time}
                        {message.mine ? <CheckCheck size={16} className="text-[#53bdeb]" /> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <footer className="flex min-h-[72px] items-center gap-3 bg-[#202c33] px-5">
                <button aria-label="Emoji" className="text-[#aebac1]">
                  <Smile size={26} />
                </button>
                <button aria-label="Attach" className="text-[#aebac1]">
                  <Paperclip size={26} />
                </button>
                <input className="h-12 min-w-0 flex-1 rounded-lg bg-[#2a3942] px-5 text-lg outline-none placeholder:text-[#aebac1]" placeholder="Type a message" />
                <button aria-label="Send" className="grid h-12 w-12 place-items-center rounded-full bg-[#00a884] text-[#06130f]">
                  <Send size={22} />
                </button>
              </footer>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="grid grid-cols-3 gap-14 text-center">
                {[
                  ["Send document", FileText],
                  ["Add contact", UserPlus],
                  ["Create group", Users],
                  ["Share media", Image]
                ].map(([label, Icon]) => (
                  <button key={label as string} className="group">
                    <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#2a3942] text-[#d1d7db] group-hover:bg-[#00a884] group-hover:text-[#06130f]">
                      <Icon size={32} />
                    </span>
                    <span className="mt-4 block text-lg font-semibold">{label as string}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function apiUrl() {
  return process.env.NEXT_PUBLIC_API_URL ?? "https://chatsphere-production-a4fd.up.railway.app";
}
