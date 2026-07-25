export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#f7f9fb] px-5 py-10 text-[#18212f]">
      <section className="mx-auto max-w-3xl rounded-2xl border border-[#dce1e8] bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#00a884]">ChatSphere</p>
        <h1 className="mt-3 text-3xl font-black tracking-normal">Terms of Use</h1>
        <p className="mt-4 leading-7 text-[#64748b]">
          By using ChatSphere, you agree to use the service responsibly and respect other users.
        </p>

        <div className="mt-8 space-y-6">
          <section>
            <h2 className="text-lg font-black">Accounts</h2>
            <p className="mt-2 leading-7 text-[#64748b]">
              You are responsible for keeping your login password private. Use a strong password that is not reused from other services.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-black">Messaging</h2>
            <p className="mt-2 leading-7 text-[#64748b]">
              Do not send spam, threats, illegal content, or private information that you do not have permission to share.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-black">Moderation</h2>
            <p className="mt-2 leading-7 text-[#64748b]">
              Users can block or report other accounts. Admins may block, unblock, or delete accounts when needed to protect the service.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-black">Attachments</h2>
            <p className="mt-2 leading-7 text-[#64748b]">
              Only upload files you have the right to share. ChatSphere may reject large files or unsafe content.
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
