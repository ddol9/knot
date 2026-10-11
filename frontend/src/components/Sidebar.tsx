"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CurrentAccount } from "@/product/apiClient";

type NavItem = { label: string; href: string };

const BRAND_NAV: NavItem[][] = [
  [
    { label: "대시보드", href: "/brand" },
    { label: "프로모션", href: "/brand/promotions" },
    { label: "정산", href: "/brand/settlement" },
  ],
  [
    { label: "마이페이지", href: "/brand/me" },
    { label: "설정", href: "/brand/settings" },
  ],
];

const CREATOR_NAV: NavItem[][] = [
  [
    { label: "대시보드", href: "/creator" },
    { label: "오퍼", href: "/creator/offers" },
    { label: "계약", href: "/creator/agreements" },
    { label: "정산", href: "/creator/settlements" },
  ],
  [
    { label: "마이페이지", href: "/creator/me" },
    { label: "설정", href: "/creator/settings" },
  ],
];

export function Sidebar({ role }: { role: NonNullable<CurrentAccount["role"]> }) {
  const pathname = usePathname();
  const groups = role === "BRAND" ? BRAND_NAV : CREATOR_NAV;

  return (
    <nav
      aria-label="Dashboard navigation"
      className="flex w-60 shrink-0 flex-col gap-6 border-r border-border-subtle/30 py-2 pr-6"
    >
      <span className="sketch-pill ink inline-flex w-fit border border-border-subtle bg-surface-raised px-3 py-1 font-mono text-[10px] uppercase text-muted">
        {role === "BRAND" ? "brand" : "creator"}
      </span>
      {groups.map((items, index) => (
        <div key={index} className="flex flex-col gap-1">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-surface-raised font-medium text-foreground"
                    : "text-muted hover:bg-surface-raised/60 hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
