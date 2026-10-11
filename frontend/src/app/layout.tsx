import type { Metadata } from "next";
import localFont from "next/font/local";
import { Geist_Mono } from "next/font/google";
import { AppFrame } from "@/app/AppFrame";
import { SquiggleFilters } from "@/components/SquiggleFilters";
import "./globals.css";

export const dynamic = "force-dynamic";

/**
 * 이서윤체 — two-user-session UI reference의 본문/헤드라인 기준 폰트.
 */
const hand = localFont({
  src: "./fonts/LeeSeoyun.ttf",
  variable: "--font-hand",
  display: "swap",
});

/** Pretendard — /b·/c 라이브 데모 셸 전용의 클린 산세리프 (로컬 파일, 네트워크 무관). */
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  display: "swap",
});

/**
 * Money, hashes, ids and policy JSON stay in mono. In a hand-drawn UI the
 * numbers are the one thing that must never look approximate.
 */
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "knot — 크리에이터와 브랜드를 잇는 매듭",
  description:
    "크리에이터의 에이전트와 브랜드의 에이전트가 사람이 정한 한도 안에서 직접 협상하고, 계약하고, 온체인으로 정산합니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${hand.variable} ${pretendard.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <SquiggleFilters />
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
