import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TravelSplit — 旅行分帳",
  description: "旅行分帳，回國一次結清",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
