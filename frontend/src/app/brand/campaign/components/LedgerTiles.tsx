"use client";

import type { BudgetLedgerSnapshot } from "@/product/campaignTypes";

const TILES: Array<{ key: keyof BudgetLedgerSnapshot; label: string; hint: string }> = [
  { key: "totalUsdc", label: "총 예산", hint: "프로모션 예산" },
  { key: "reservedUsdc", label: "예약 중", hint: "진행 중인 협상이 잡아둔 상한" },
  { key: "committedUsdc", label: "확정", hint: "합의되어 에스크로로 갈 금액" },
  { key: "availableUsdc", label: "가용", hint: "아직 예약하지 않은 금액" },
];

export function LedgerTiles({ ledger }: { ledger: BudgetLedgerSnapshot | null }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {TILES.map((tile) => (
        <div key={tile.key} className="sketch-alt ink border border-border-subtle bg-background p-3">
          <p className="text-xs text-muted">{tile.label}</p>
          <p className="mt-1 font-mono text-xl">
            {ledger ? ledger[tile.key].toLocaleString() : "–"}
            <span className="ml-1 text-xs text-muted">USDC</span>
          </p>
          <p className="mt-1 text-[10px] text-muted">{tile.hint}</p>
        </div>
      ))}
    </div>
  );
}
