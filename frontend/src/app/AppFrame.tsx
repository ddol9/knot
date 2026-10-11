"use client";

import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { isDashboardShellPath } from "@/auth/authState";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

/** /b(브랜드)·/c(크리에이터) 라이브 데모는 자체 셸을 쓴다 — 기존 세계관 미적용. */
function isDemoPath(pathname: string) {
  return (
    pathname === "/b" ||
    pathname.startsWith("/b/") ||
    pathname === "/c" ||
    pathname.startsWith("/c/") ||
    pathname === "/auth"
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { context } = useAuth();
  const role = context?.account.role ?? null;
  const isLanding = pathname === "/";
  const showSidebar = Boolean(role) && isDashboardShellPath(pathname);

  if (isDemoPath(pathname)) {
    return <>{children}</>;
  }

  return (
    <>
      <TopBar />
      <main className={isLanding ? "w-full flex-1" : "mx-auto flex w-full max-w-6xl flex-1 gap-8 px-4 py-8"}>
        {showSidebar && role ? <Sidebar role={role} /> : null}
        <div className="min-w-0 flex-1">{children}</div>
      </main>
    </>
  );
}

export function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
