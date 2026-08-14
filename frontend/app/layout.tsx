import type { Metadata } from "next";
import { ToastProvider } from "@/lib/ToastContext";
import SessionProviderWrapper from "@/components/SessionProviderWrapper";
import { auth } from "@/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "TravelSplit — 旅行分帳",
  description: "旅行分帳，回國一次結清",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolved server-side (reads the already-verified NextAuth session
  // cookie — cheap, no network round trip) and seeded into SessionProvider
  // below so useSession() is synchronously correct on first client render
  // instead of only after its own async /api/auth/session fetch resolves.
  // See SessionProviderWrapper.tsx's docstring for why that race matters.
  const session = await auth();
  return (
    <html lang="zh-Hant" className="h-full">
      <body className="min-h-full flex flex-col">
        <SessionProviderWrapper session={session}>
          <ToastProvider>{children}</ToastProvider>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
