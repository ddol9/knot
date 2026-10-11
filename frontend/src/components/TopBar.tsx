"use client";

/**
 * 글로벌 네비게이션 — /b·/c 워크스페이스와 같은 클린 감도(Pretendard, 화이트/블랙).
 * 랜딩 본문(iframe)의 손그림 세계관은 그대로 두고, 내비만 프로덕트 톤으로 맞춘다.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { getMyPagePath, headerMenuForAuth, isDashboardShellPath } from "@/auth/authState";

const FONT_STACK =
  "var(--font-pretendard), 'Apple SD Gothic Neo', system-ui, sans-serif";

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { status, context, dashboardPath, logout } = useAuth();
  const sidebarActive = Boolean(context?.account.role) && isDashboardShellPath(pathname);
  const menu = headerMenuForAuth(status, context?.account.role).filter(
    (item) => !sidebarActive || (item !== "dashboard" && item !== "mypage"),
  );

  async function handleLogout() {
    await logout();
    router.push("/");
  }

  return (
    <header
      className="sticky top-0 z-50 border-b border-[#e8e8ec] bg-white/85 backdrop-blur"
      style={{ fontFamily: FONT_STACK, letterSpacing: "-0.011em" }}
    >
      <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2">
        <Link href="/" className="flex items-baseline gap-2.5">
          <span className="text-[21px] font-black tracking-tight text-[#18181b]" style={{ filter: "none" }}>
            knot
          </span>
          <span className="hidden text-[12px] text-[#8e8e96] sm:inline">
            크리에이터 × 브랜드, 에이전트끼리
          </span>
        </Link>

        <div className="flex flex-wrap items-center gap-2.5">
          {context?.account.role ? (
            <span className="hidden rounded-md bg-black/[0.06] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-[#8e8e96] sm:inline-flex">
              {context.account.role}
            </span>
          ) : null}
          <nav aria-label="Product navigation" className="flex flex-wrap items-center gap-2 text-[13.5px]">
            {menu.includes("loading") && (
              <span
                className="inline-block h-4 w-28 animate-pulse rounded-full bg-black/[0.06]"
                aria-label="인증 상태 확인 중"
              />
            )}
            {menu.includes("login") && <NavLink href="/auth">로그인</NavLink>}
            {menu.includes("signup") && (
              <Link
                href="/auth"
                className="rounded-xl bg-[#18181b] px-3.5 py-1.5 font-semibold text-white transition-all hover:bg-black active:scale-[0.98]"
              >
                시작하기
              </Link>
            )}
            {menu.includes("dashboard") && dashboardPath && (
              <NavLink href={dashboardPath}>대시보드</NavLink>
            )}
            {menu.includes("mypage") && (
              <NavLink href={getMyPagePath(context?.account.role)}>마이페이지</NavLink>
            )}
            {menu.includes("logout") && (
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-xl px-3 py-1.5 font-semibold text-[#3f3f46] transition-colors hover:bg-black/[0.05]"
              >
                로그아웃
              </button>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-[#d9d9de] bg-white px-3.5 py-1.5 font-semibold text-[#18181b] transition-all hover:border-[#18181b] active:scale-[0.98]"
    >
      {children}
    </Link>
  );
}
