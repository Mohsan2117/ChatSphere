import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChatSphere",
  description: "Real-time messaging for private chats, groups, media, and presence."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
