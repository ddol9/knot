"use client";

/**
 * /auth — 신규 앱 로그인. 구글 · 이메일 · 팬텀 지갑, 브랜드↔크리에이터 토글.
 * 성공하면 KnotSession을 남기고 역할에 따라 /b 또는 /c로 보낸다.
 */

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import "@/demo/demo.css";
import {
  createFirebaseAccount,
  firebaseAuthErrorMessage,
  firebaseConfigured,
  signInWithEmail,
  signInWithGoogle,
} from "@/auth/firebaseClient";
import { connectPhantom, isPhantomAvailable, signPhantomMessage } from "@/features/wallet/phantom";
import { saveSession, shortAddress, type KnotRole } from "@/demo/auth/session";
import { Yarn } from "@/demo/character/Yarn";
import { Button } from "@/demo/ui/primitives";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.3H12v4.3h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.8 2.9c2.3-2.1 3.6-5.1 3.6-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-4.9L1.3 17.4C3.3 21.3 7.3 24 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4L1.3 6.6C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l4-3z" />
      <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.6 1.4L19 2.9C17 1.1 14.7 0 12 0 7.3 0 3.3 2.7 1.3 6.6l4 3.1C6.2 6.8 8.9 4.7 12 4.7z" />
    </svg>
  );
}

function AuthInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [role, setRole] = useState<KnotRole>(params.get("role") === "creator" ? "creator" : "brand");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // to를 명시하지 않으면 현재 토글 역할 기준 — 페르소나 버튼은 역할이 고정이라 명시한다
  // (setRole 직후 done()이 stale 클로저로 잘못된 곳에 보내는 버그 방지).
  const withBusy = (key: string, fn: () => Promise<void>, to?: string) => async () => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await fn();
      router.replace(to ?? (role === "brand" ? "/b" : "/c"));
    } catch (caught) {
      setError(firebaseAuthErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const google = withBusy("google", async () => {
    const user = await signInWithGoogle();
    saveSession({
      method: "google",
      role,
      name: user.displayName || user.email || "사용자",
      email: user.email,
      photo: user.photoURL,
      wallet: null,
    });
  });

  const emailAuth = withBusy("email", async () => {
    const user =
      mode === "login"
        ? await signInWithEmail(email.trim(), password)
        : await createFirebaseAccount(email.trim(), password, name);
    saveSession({
      method: "email",
      role,
      name: user.displayName || name.trim() || user.email || "사용자",
      email: user.email,
      photo: user.photoURL,
      wallet: null,
    });
  });

  const wallet = withBusy("wallet", async () => {
    const address = await connectPhantom();
    // 소유 증명 서명 — 자금 이동 없는 로그인 서명
    await signPhantomMessage(`knot 로그인\n주소: ${address}\n시각: ${new Date().toISOString()}`);
    saveSession({
      method: "wallet",
      role,
      name: shortAddress(address),
      email: null,
      photo: null,
      wallet: address,
    });
  });

  const emailReady = /\S+@\S+\.\S+/.test(email) && password.length >= 6 && (mode === "login" || name.trim());

  return (
    <div data-knot-demo className="flex min-h-screen flex-col items-center justify-center px-6 py-10">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[400px]"
      >
        {/* 헤더 */}
        <div className="flex flex-col items-center">
          <div className="flex items-end gap-1">
            <Yarn color="#d9a441" size={56} mood={role === "brand" ? "happy" : "sleep"} />
            <Yarn color="#e8896b" size={56} mood={role === "creator" ? "happy" : "sleep"} flip />
          </div>
          <div className="mt-3 text-[26px] font-black tracking-tight">knot</div>
          <div className="mt-1 text-[13.5px] text-[var(--k-muted)]">
            에이전트가 대신 뛰는 크리에이터 커머스
          </div>
        </div>

        {/* 역할 토글 */}
        <div className="mt-7 grid grid-cols-2 rounded-xl bg-black/[0.05] p-1">
          {(
            [
              { key: "brand", label: "브랜드로 시작" },
              { key: "creator", label: "크리에이터로 시작" },
            ] as const
          ).map((r) => (
            <button
              key={r.key}
              onClick={() => setRole(r.key)}
              className={`h-9 rounded-lg text-[13px] font-bold transition-all ${
                role === r.key ? "bg-white shadow-sm" : "text-[var(--k-muted)] hover:text-[var(--k-ink)]"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* 소셜/지갑 */}
        <div className="mt-4 space-y-2">
          <button
            onClick={google}
            disabled={!!busy || !firebaseConfigured()}
            className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-[var(--k-line-strong)] bg-white text-[14px] font-semibold transition-all hover:border-[var(--k-ink)] active:scale-[0.99] disabled:opacity-50"
          >
            <GoogleIcon />
            {busy === "google" ? "구글 로그인 중…" : "구글로 계속하기"}
          </button>
          <button
            onClick={wallet}
            disabled={!!busy}
            className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-[#ab9ff2] bg-white text-[14px] font-semibold text-[#5341c8] transition-all hover:bg-[#ab9ff2]/10 active:scale-[0.99] disabled:opacity-50"
          >
            <svg viewBox="0 0 128 128" width="17" height="17" fill="#ab9ff2">
              <circle cx="64" cy="64" r="64" fill="#ab9ff2" />
              <path
                d="M108 66c0 23-17 40-39 40-25 0-46-21-46-47C23 38 36 25 52 25c39 0 30 41 43 41 7 0 13-6 13-13v13z"
                fill="#fff"
              />
            </svg>
            {busy === "wallet"
              ? "지갑 서명 대기 중…"
              : isPhantomAvailable()
                ? "Phantom 지갑으로 계속하기"
                : "지갑으로 계속하기 (Phantom 설치 필요)"}
          </button>
        </div>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--k-line)]" />
          <span className="text-[11px] font-semibold text-[var(--k-muted)]">또는 이메일로</span>
          <div className="h-px flex-1 bg-[var(--k-line)]" />
        </div>

        {/* 이메일 */}
        <div className="space-y-2">
          {mode === "signup" && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="이름"
              className="h-11 w-full rounded-xl border border-[var(--k-line-strong)] bg-white px-3.5 text-[14px] outline-none transition-colors focus:border-[var(--k-ink)]"
            />
          )}
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일"
            type="email"
            className="h-11 w-full rounded-xl border border-[var(--k-line-strong)] bg-white px-3.5 text-[14px] outline-none transition-colors focus:border-[var(--k-ink)]"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && emailReady) emailAuth();
            }}
            placeholder="비밀번호 (6자 이상)"
            type="password"
            className="h-11 w-full rounded-xl border border-[var(--k-line-strong)] bg-white px-3.5 text-[14px] outline-none transition-colors focus:border-[var(--k-ink)]"
          />
          <Button
            className="w-full"
            size="lg"
            onClick={emailAuth}
            disabled={!!busy || !emailReady || !firebaseConfigured()}
          >
            {busy === "email" ? "처리 중…" : mode === "login" ? "이메일로 로그인" : "가입하고 시작하기"}
          </Button>
        </div>

        <div className="mt-3 text-center text-[12.5px] text-[var(--k-muted)]">
          {mode === "login" ? (
            <>
              처음이신가요?{" "}
              <button onClick={() => setMode("signup")} className="font-bold text-[var(--k-ink)] underline-offset-2 hover:underline">
                이메일로 가입
              </button>
            </>
          ) : (
            <>
              이미 계정이 있어요.{" "}
              <button onClick={() => setMode("login")} className="font-bold text-[var(--k-ink)] underline-offset-2 hover:underline">
                로그인
              </button>
            </>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-red-600">
            {error}
          </div>
        )}

        {/* 데모 페르소나 — 백엔드 시드 계정(t1/c1)으로 원클릭 입장 */}
        <div className="mt-6 rounded-xl border border-dashed border-[var(--k-line-strong)] px-3.5 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--k-muted)]">
            데모 페르소나로 입장
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              onClick={withBusy("persona-brand", async () => {
                setRole("brand");
                const user = await signInWithEmail("t1@knot.com", "000000");
                saveSession({
                  method: "persona",
                  role: "brand",
                  name: user.displayName || "체리엑스엑스",
                  email: user.email,
                  photo: user.photoURL,
                  wallet: null,
                });
              }, "/b")}
              disabled={!!busy || !firebaseConfigured()}
              className="h-9 rounded-lg bg-black/[0.05] text-[12px] font-bold text-[var(--k-ink-soft)] transition-colors hover:bg-black/[0.1] disabled:opacity-40"
            >
              {busy === "persona-brand" ? "입장 중…" : "🏪 브랜드 (t1)"}
            </button>
            <button
              onClick={withBusy("persona-creator", async () => {
                setRole("creator");
                const user = await signInWithEmail("c1@knot.com", "000000");
                saveSession({
                  method: "persona",
                  role: "creator",
                  name: user.displayName || "씬님",
                  email: user.email,
                  photo: user.photoURL,
                  wallet: null,
                });
              }, "/c")}
              disabled={!!busy || !firebaseConfigured()}
              className="h-9 rounded-lg bg-black/[0.05] text-[12px] font-bold text-[var(--k-ink-soft)] transition-colors hover:bg-black/[0.1] disabled:opacity-40"
            >
              {busy === "persona-creator" ? "입장 중…" : "⭐ 크리에이터 (c1)"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthInner />
    </Suspense>
  );
}
