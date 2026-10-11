"use client";

/**
 * 실시간 devnet 증빙 카드 — 대본 연출과 별개로 진짜 백엔드/온체인 상태를 보여준다.
 * 브랜드 창: 프로모션 생성 트리거 + Phantom 예치 서명.
 * 크리에이터 창: 정산 받을 Phantom 지갑 등록 + 릴리즈 서명 확인.
 */

import { useState } from "react";
import {
  connectRealCreatorWallet,
  fundRealChainEscrow,
  startRealChain,
  useDemo,
} from "@/demo/engine/store";
import { useKnotSession } from "@/demo/auth/session";
import { explorerUrl } from "@/demo/real/apiFlow";
import { Badge, Button, SectionLabel } from "@/demo/ui/primitives";

function shortAddr(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function TxLink({ signature, label }: { signature: string; label: string }) {
  return (
    <a
      href={explorerUrl(signature)}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-2 rounded-lg bg-black/[0.04] px-2.5 py-1.5 text-[12px] transition-colors hover:bg-black/[0.08]"
    >
      <span className="text-[var(--k-ink-soft)]">{label}</span>
      <span className="k-mono text-[var(--k-muted)]">{shortAddr(signature)} ↗</span>
    </a>
  );
}

export function RealChainCard({ role }: { role: "brand" | "creator" }) {
  const s = useDemo();
  const real = s.real;
  const session = useKnotSession();
  const [busy, setBusy] = useState(false);

  // "지갑으로 로그인"은 Firebase 토큰이 없어서 실제 백엔드 호출이 전부 401난다 —
  // 이메일/구글/페르소나 로그인일 때만 이 카드의 버튼들을 보여준다.
  if (session?.method === "wallet") {
    return (
      <div className="k-card px-4 py-3.5">
        <div className="flex items-center justify-between">
          <SectionLabel>실시간 devnet 증빙</SectionLabel>
          <Badge tone="neutral">로그인 필요</Badge>
        </div>
        <p className="mt-3 text-[12.5px] text-[var(--k-muted)]">
          지갑 로그인에서는 이 기능을 쓸 수 없어요 — 이메일·구글·데모 페르소나 로그인에서 사용 가능합니다.
        </p>
      </div>
    );
  }

  async function withBusy(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  const statusLabel: Record<string, string> = {
    idle: "대기 중",
    creating: "실제 프로모션 생성 중…",
    waiting_creator: "매칭된 크리에이터 대기 중",
    agreed: "협상 체결 — 예치 대기",
    funding: "지갑 서명 대기 중…",
    funded: "예치 완료 — 콘텐츠 증빙 대기",
    submitting_evidence: "증빙 제출/검증 중…",
    released: "정산 완료",
    error: "오류",
  };

  return (
    <div className="k-card px-4 py-3.5">
      <div className="flex items-center justify-between">
        <SectionLabel>실시간 devnet 증빙</SectionLabel>
        {real ? (
          <Badge tone={real.status === "released" ? "money" : real.status === "error" ? "danger" : "ink"}>
            {statusLabel[real.status] ?? real.status}
          </Badge>
        ) : (
          <Badge tone="neutral">대기 중</Badge>
        )}
      </div>

      {!real || real.status === "idle" || real.status === "error" || real.status === "waiting_creator" ? (
        role === "brand" ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-[12.5px] text-[var(--k-muted)]">
              대본 연출과 별개로, 실제 백엔드에 프로모션을 만들고 devnet에서 진짜 에스크로·정산을 실행합니다.
            </p>
            {real?.error ? (
              <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[12px] font-semibold text-red-600">
                {real.error}
              </p>
            ) : null}
            <Button size="sm" onClick={() => withBusy(startRealChain)} disabled={busy || !s.brand}>
              {busy
                ? "처리 중…"
                : real?.status === "error" || real?.status === "waiting_creator"
                  ? "다시 시도"
                  : "실제 devnet으로 진행하기"}
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-[12.5px] text-[var(--k-muted)]">
            브랜드가 진짜 devnet 진행을 시작하면 여기에 실시간 상태가 표시됩니다.
          </p>
        )
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {real.amountUsdc != null && (
            <p className="text-[12.5px] text-[var(--k-ink-soft)]">
              협상 금액 <span className="k-mono font-bold">{real.amountUsdc.toLocaleString()} USDC</span>
              {real.network ? ` · ${real.network}` : ""}
            </p>
          )}

          {role === "brand" && real.status === "agreed" ? (
            <Button size="sm" onClick={() => withBusy(fundRealChainEscrow)} disabled={busy}>
              {busy ? "지갑 서명 대기…" : "Phantom 지갑 연결해서 예치 서명"}
            </Button>
          ) : null}

          {role === "creator" && !real.creatorWallet ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => withBusy(connectRealCreatorWallet)}
              disabled={busy}
            >
              {busy ? "지갑 연결 중…" : "정산 받을 Phantom 지갑 연결"}
            </Button>
          ) : null}

          {real.creatorWallet ? (
            <p className="text-[11px] text-[var(--k-muted)]">
              정산 지갑: <span className="k-mono">{shortAddr(real.creatorWallet)}</span>
            </p>
          ) : null}

          {real.fundingSignature ? (
            <TxLink signature={real.fundingSignature} label="🔒 예치 트랜잭션" />
          ) : null}
          {real.releaseSignature ? (
            <TxLink signature={real.releaseSignature} label="💸 정산 릴리즈 트랜잭션" />
          ) : null}

          {real.error ? (
            <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[12px] font-semibold text-red-600">
              {real.error}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
