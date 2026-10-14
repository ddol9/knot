"use client";

import Link from "next/link";
import type { CampaignTurn } from "@/product/campaignTypes";
import { TURN_TYPE_LABEL, type ColumnFinalKind, type ColumnNote, type CreatorColumn } from "../useCampaignStream";
import { Pill } from "./DiscoveryTable";

function finalTone(kind: ColumnFinalKind): "positive" | "negative" | "caution" {
  if (kind === "AGREED") return "positive";
  if (kind === "REJECTED" || kind === "ERROR") return "negative";
  return "caution";
}

export function NegotiationColumn({ column }: { column: CreatorColumn }) {
  return (
    <article className="sketch ink flex w-[300px] shrink-0 snap-start flex-col border border-border-subtle bg-surface p-4 sm:w-[340px]">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xl">{column.displayName}</p>
          <p className="truncate font-mono text-[10px] text-muted">{column.creatorAgentId}</p>
        </div>
        <span className="shrink-0 text-right text-[11px] text-muted">
          {column.statusText}
          {column.typing ? <TypingDots /> : null}
        </span>
      </header>

      <div className="flex min-h-[120px] flex-1 flex-col gap-2">
        {column.turns.length === 0 && !column.final ? (
          <p className="text-sm text-muted">첫 제안을 기다리는 중…</p>
        ) : null}
        {column.turns.map((turn) => (
          <TurnBubble key={turn.messageId ?? `${turn.role}-${turn.round}-${turn.type}`} turn={turn} />
        ))}
      </div>

      {column.final ? (
        <div className="mt-3">
          <Pill tone={finalTone(column.final.kind)}>{column.final.label}</Pill>
        </div>
      ) : null}

      {column.notes.map((note) => (
        <NoteBox key={note.id} note={note} />
      ))}
    </article>
  );
}

function TurnBubble({ turn }: { turn: CampaignTurn }) {
  const brand = turn.role === "brand";
  return (
    <div
      className={`max-w-[88%] border border-border-subtle px-3 py-2 ${
        brand ? "sketch-alt self-start bg-background" : "sketch self-end bg-surface-raised"
      }`}
    >
      <p className="text-[10px] text-muted">
        {turn.round}라운드 · {brand ? "브랜드 매니저" : "크리에이터 매니저"}
        {turn.messageProvider && turn.messageProvider !== "deterministic" ? ` · ${turn.messageProvider}` : ""}
      </p>
      <p className="mt-0.5 flex items-baseline gap-2">
        <span className="font-mono text-base">{turn.amountUsdc.toLocaleString()} USDC</span>
        <Pill tone={brand ? "accent" : "muted"}>{TURN_TYPE_LABEL[turn.type] ?? turn.type}</Pill>
      </p>
      {turn.message ? <p className="mt-1 whitespace-pre-wrap text-sm leading-5">{turn.message}</p> : null}
    </div>
  );
}

function NoteBox({ note }: { note: ColumnNote }) {
  const tone =
    note.kind === "escrow_failed"
      ? "text-negative"
      : note.kind === "escrow_skipped" || note.kind === "approval_required"
        ? "text-caution"
        : "text-foreground";
  return (
    <div className="sketch-alt mt-2 border border-dashed border-border-subtle bg-background px-3 py-2 text-xs">
      <p className={`font-semibold ${tone}`}>{note.title}</p>
      {note.lines.map((line, index) => (
        <p key={index} className="mt-0.5 break-all font-mono text-[10px] text-muted">
          {line}
        </p>
      ))}
      <p className="mt-1 flex flex-wrap gap-3">
        {note.agreementId ? (
          <Link href={`/brand/agreements/${note.agreementId}`} className="underline underline-offset-2">
            합의서 보기
          </Link>
        ) : null}
        {note.approvalId ? (
          <Link
            href={`/brand/approvals?focus=${encodeURIComponent(note.approvalId)}`}
            className="underline underline-offset-2"
          >
            승인 큐에서 결정
          </Link>
        ) : null}
        {note.explorerUrl ? (
          <a href={note.explorerUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Explorer
          </a>
        ) : null}
      </p>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="ml-1 inline-flex gap-0.5 align-middle" aria-label="응답 대기 중">
      <span className="h-1 w-1 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-muted" />
    </span>
  );
}
