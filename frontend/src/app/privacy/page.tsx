export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#f7f9fb] px-5 py-10 text-[#18212f]">
      <section className="mx-auto max-w-3xl rounded-2xl border border-[#dce1e8] bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#00a884]">ChatSphere</p>
        <h1 className="mt-3 text-3xl font-black tracking-normal">Privacy Policy</h1>
        <p className="mt-4 leading-7 text-[#64748b]">
          ChatSphere stores account details, profile information, messages, attachments, blocks, and reports so the chat service can work across devices and sessions.
        </p>

        <div className="mt-8 space-y-6">
          <section>
            <h2 className="text-lg font-black">Data We Store</h2>
            <p className="mt-2 leading-7 text-[#64748b]">
              We store your email address, hashed password, first name, optional last name, optional profile photo, sent and received messages, file metadata, small uploaded files, read state, and moderation reports.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-black">How Data Is Used</h2>
            <p className="mt-2 leading-7 text-[#64748b]">
              Your data is used to authenticate your account, deliver private messages to the correct users, show inbox history, support profile updates, and help admins block abusive accounts or resolve reports.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-black">Security</h2>
            <p className="mt-2 leading-7 text-[#64748b]">
              Passwords are stored as hashes. Message APIs require authenticated tokens, and the backend checks sender and recipient access before returning messages.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-black">Contact</h2>
            <p className="mt-2 leading-7 text-[#64748b]">
              For privacy questions, contact the ChatSphere administrator from the account email used to register.
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
