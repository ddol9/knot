"use client";

/** 로그인 세션 표시 — 사이드바(브랜드)·헤더(크리에이터) 공용. 지갑 연결/로그아웃 포함. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { connectPhantom } from "@/features/wallet/phantom";
import { signOutFirebase, firebaseConfigured } from "@/auth/firebaseClient";
import { withBase } from "@/demo/ui/asset";
import { useUsdcBalance, formatUsdc } from "@/demo/wallet/balance";
import { clearSession, shortAddress, updateSession, useKnotSession } from "./session";

const METHOD_LABEL = {
  google: "구글",
  email: "이메일",
  wallet: "Phantom",
  persona: "데모 페르소나",
} as const;

function Avatar({ photo, name, size = 28 }: { photo: string | null; name: string; size?: number }) {
  if (photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={withBase(photo)}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover ring-1 ring-black/10"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-[var(--k-ink)] font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function IdentityBlock({ variant }: { variant: "sidebar" | "header" }) {
  const router = useRouter();
  const session = useKnotSession();
  const [busy, setBusy] = useState(false);
  const { balance: realUsdc, failed: balanceFailed } = useUsdcBalance(session?.wallet);
  if (!session) return null;

  const logout = async () => {
    clearSession();
    if (firebaseConfigured() && (session.method === "google" || session.method === "email" || session.method === "persona")) {
      try {
        await signOutFirebase();
      } catch {
        // 세션은 이미 지웠으니 무시
      }
    }
    router.replace("/auth");
  };

  const connectWallet = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const address = await connectPhantom();
      updateSession({ wallet: address });
    } catch {
      // 사용자가 취소 — 조용히 무시
    } finally {
      setBusy(false);
    }
  };

  if (variant === "header") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--k-line)] bg-white px-2.5 py-1.5">
        <Avatar photo={session.photo} name={session.name} size={22} />
        <span className="max-w-[110px] truncate text-[12px] font-bold">{session.name}</span>
        {session.wallet ? (
          <span className="k-mono rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[10px] text-[var(--k-muted)]">
            {shortAddress(session.wallet)}
            {realUsdc !== null && (
              <span className="ml-1 font-bold text-emerald-700">{formatUsdc(realUsdc)} USDC</span>
            )}
          </span>
        ) : (
          <button
            onClick={connectWallet}
            className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-bold text-[var(--k-ink-soft)] hover:bg-black/[0.1]"
          >
            {busy ? "…" : "지갑 연결"}
          </button>
        )}
        <button
          onClick={logout}
          title="로그아웃"
          className="text-[11px] text-[var(--k-muted)] hover:text-[var(--k-ink)]"
        >
          ⏻
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--k-line)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Avatar photo={session.photo} name={session.name} size={28} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-bold">{session.name}</div>
          <div className="text-[10px] text-[var(--k-muted)]">
            {METHOD_LABEL[session.method]} 로그인
          </div>
        </div>
        <button
          onClick={logout}
          title="로그아웃"
          className="rounded-md px-1.5 py-1 text-[11px] text-[var(--k-muted)] hover:bg-black/[0.05] hover:text-[var(--k-ink)]"
        >
          ⏻
        </button>
      </div>
      <div className="mt-2">
        {session.wallet ? (
          <div className="space-y-1">
            <div className="k-mono flex items-center justify-between rounded-lg bg-black/[0.04] px-2 py-1.5 text-[10.5px]">
              <span className="text-[var(--k-muted)]">Solana</span>
              <span className="font-bold">{shortAddress(session.wallet)}</span>
            </div>
            <div className="k-mono flex items-center justify-between rounded-lg bg-emerald-50 px-2 py-1.5 text-[10.5px]">
              <span className="text-emerald-700">USDC · devnet</span>
              <span className="font-bold text-emerald-800">
                {realUsdc !== null ? formatUsdc(realUsdc) : balanceFailed ? "—" : "조회 중…"}
              </span>
            </div>
          </div>
        ) : (
          <button
            onClick={connectWallet}
            className="w-full rounded-lg border border-dashed border-[#ab9ff2] px-2 py-1.5 text-[11px] font-bold text-[#5341c8] transition-colors hover:bg-[#ab9ff2]/10"
          >
            {busy ? "지갑 연결 중…" : "👛 Phantom 지갑 연결"}
          </button>
        )}
      </div>
    </div>
  );
}
