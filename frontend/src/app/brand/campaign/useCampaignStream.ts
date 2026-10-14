"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  CAMPAIGN_STREAM_EVENT_NAMES,
  type BudgetLedgerSnapshot,
  type CampaignResult,
  type CampaignStreamEvent,
  type CampaignStreamEventName,
  type CampaignTurn,
  type DiscoveryReport,
  type NegotiationOutcome,
} from "@/product/campaignTypes";

/* ---------- view state ---------- */

export type CampaignPhase = "idle" | "connecting" | "running" | "done" | "error";

export type ColumnFinalKind = NegotiationOutcome | "SKIPPED" | "ERROR";

export type ColumnNote = {
  id: string;
  kind: "agreement" | "escrow_locked" | "escrow_skipped" | "escrow_failed";
  title: string;
  lines: string[];
  agreementId?: string;
  explorerUrl?: string | null;
};

export type CreatorColumn = {
  creatorAgentId: string;
  displayName: string;
  baseUrl: string | null;
  /** 상단 상태 문구 (대기 / 첫 제안 작성 중 / COUNTER 받음 … / 종료) */
  statusText: string;
  typing: boolean;
  turns: CampaignTurn[];
  final: { kind: ColumnFinalKind; label: string } | null;
  notes: ColumnNote[];
  agreementId: string | null;
};

export type CampaignStreamState = {
  phase: CampaignPhase;
  campaignId: string | null;
  a2aMode: string | null;
  discovery: DiscoveryReport | null;
  ledger: BudgetLedgerSnapshot | null;
  columnOrder: string[];
  columns: Record<string, CreatorColumn>;
  result: CampaignResult | null;
  error: string | null;
};

export const initialCampaignStreamState: CampaignStreamState = {
  phase: "idle",
  campaignId: null,
  a2aMode: null,
  discovery: null,
  ledger: null,
  columnOrder: [],
  columns: {},
  result: null,
  error: null,
};

type Action =
  | { type: "reset" }
  | { type: "connecting" }
  | { type: "event"; event: CampaignStreamEvent }
  | { type: "connection_lost"; detail: string };

/* ---------- labels (docs/18 어휘에 맞춘 한국어 카피) ---------- */

export const NEGOTIATION_OUTCOME_LABEL: Record<NegotiationOutcome, string> = {
  AGREED: "합의",
  REJECTED: "거절",
  ESCALATED: "사람 검토 필요",
  WALKED_AWAY: "상한 초과로 철수",
  ROUND_LIMIT: "라운드 초과",
  CANCELED: "목표 도달로 취소",
};

export const CAMPAIGN_OUTCOME_LABEL: Record<CampaignResult["outcome"], string> = {
  TARGET_REACHED: "목표 달성",
  PARTIAL: "일부 합의",
  NO_AGREEMENT: "합의 없음",
  NO_CANDIDATES: "후보 없음",
  CANCELED: "브랜드가 취소",
};

export const TURN_TYPE_LABEL: Record<CampaignTurn["type"], string> = {
  OFFER: "제안",
  COUNTER: "역제안",
  ACCEPT: "수락",
  REJECT: "거절",
  ESCALATE: "에스컬레이션",
};

function outcomeLabel(outcome: NegotiationOutcome, finalAmountUsdc: number | null) {
  if (outcome === "AGREED") {
    return `합의 ${finalAmountUsdc?.toLocaleString() ?? "-"} USDC`;
  }
  return NEGOTIATION_OUTCOME_LABEL[outcome] ?? outcome;
}

/* ---------- reducer ---------- */

function emptyColumn(creatorAgentId: string, displayName?: string, baseUrl?: string | null): CreatorColumn {
  return {
    creatorAgentId,
    displayName: displayName ?? creatorAgentId,
    baseUrl: baseUrl ?? null,
    statusText: "대기",
    typing: false,
    turns: [],
    final: null,
    notes: [],
    agreementId: null,
  };
}

function withColumn(
  state: CampaignStreamState,
  creatorAgentId: string,
  update: (column: CreatorColumn) => CreatorColumn,
  seed?: { displayName?: string; baseUrl?: string | null },
): CampaignStreamState {
  const existing = state.columns[creatorAgentId] ?? emptyColumn(creatorAgentId, seed?.displayName, seed?.baseUrl);
  const columnOrder = state.columns[creatorAgentId] ? state.columnOrder : [...state.columnOrder, creatorAgentId];
  return {
    ...state,
    columnOrder,
    columns: { ...state.columns, [creatorAgentId]: update(existing) },
  };
}

function appendNote(column: CreatorColumn, note: ColumnNote): CreatorColumn {
  if (column.notes.some((item) => item.id === note.id)) return column;
  return { ...column, notes: [...column.notes, note] };
}

export function campaignStreamReducer(state: CampaignStreamState, action: Action): CampaignStreamState {
  switch (action.type) {
    case "reset":
      return initialCampaignStreamState;
    case "connecting":
      return { ...initialCampaignStreamState, phase: "connecting" };
    case "connection_lost":
      if (state.phase === "done" || state.phase === "error") return state;
      return { ...state, phase: "error", error: action.detail };
    case "event":
      return applyEvent(state, action.event);
    default:
      return state;
  }
}

function applyEvent(state: CampaignStreamState, event: CampaignStreamEvent): CampaignStreamState {
  switch (event.name) {
    case "status":
      return {
        ...state,
        phase: "running",
        campaignId: event.data.campaignId,
        a2aMode: event.data.a2aMode,
      };

    case "discovery": {
      const report = event.data.report;
      let next: CampaignStreamState = { ...state, phase: "running", discovery: report };
      for (const candidate of report.candidates) {
        if (!candidate.selected) continue;
        next = withColumn(next, candidate.creatorAgentId, (column) => column, {
          displayName: candidate.displayName,
          baseUrl: candidate.baseUrl,
        });
      }
      return next;
    }

    case "negotiation_started":
      return withColumn(
        { ...state, ledger: event.data.ledger },
        event.data.creatorAgentId,
        (column) => ({
          ...column,
          baseUrl: event.data.baseUrl ?? column.baseUrl,
          statusText: `예약 ${event.data.reservedUsdc.toLocaleString()} USDC · 첫 제안 작성 중`,
          typing: true,
        }),
      );

    case "negotiation_skipped":
      return withColumn({ ...state, ledger: event.data.ledger }, event.data.creatorAgentId, (column) => ({
        ...column,
        typing: false,
        statusText: "시작 안 함",
        final: {
          kind: "SKIPPED",
          label:
            event.data.reason === "TARGET_REACHED"
              ? "목표 인원 도달로 시작하지 않음"
              : event.data.reason === "CANCELED"
                ? "캠페인 취소로 시작하지 않음"
                : "예산 소진으로 시작하지 않음",
        },
      }));

    case "negotiation_error":
      return withColumn(state, event.data.creatorAgentId, (column) => ({
        ...column,
        typing: false,
        statusText: "오류",
        final: { kind: "ERROR", label: event.data.detail },
      }));

    case "turn": {
      const turn = event.data;
      return withColumn(state, turn.creatorAgentId, (column) => {
        const statusText =
          turn.role === "brand"
            ? `${TURN_TYPE_LABEL[turn.type] ?? turn.type} 전송 · 크리에이터 평가 중`
            : turn.type === "COUNTER"
              ? "역제안 받음 · 브랜드 검토 중"
              : `${TURN_TYPE_LABEL[turn.type] ?? turn.type} 응답`;
        const typing = turn.role === "brand" || turn.type === "COUNTER";
        return { ...column, turns: [...column.turns, turn], statusText, typing };
      });
    }

    case "negotiation_result": {
      const result = event.data.result;
      return withColumn({ ...state, ledger: event.data.ledger }, event.data.creatorAgentId, (column) => ({
        ...column,
        typing: false,
        statusText: "종료",
        agreementId: result.agreementId ?? column.agreementId,
        final: { kind: result.outcome, label: outcomeLabel(result.outcome, result.finalAmountUsdc) },
      }));
    }

    case "agreement_created": {
      const data = event.data;
      return withColumn(state, data.creatorAgentId, (column) =>
        appendNote(
          { ...column, agreementId: data.agreementId },
          {
            id: `agreement:${data.agreementId}`,
            kind: "agreement",
            title: "합의서 생성",
            lines: [
              `${data.amountUsdc.toLocaleString()} USDC · ${data.deliverableSummary}`,
              `termsHash ${data.termsHash}`,
            ],
            agreementId: data.agreementId,
          },
        ),
      );
    }

    case "escrow_locked": {
      const data = event.data;
      return withColumn(state, data.creatorAgentId, (column) =>
        appendNote(column, {
          id: `escrow_locked:${data.agreementId}`,
          kind: "escrow_locked",
          title: "에스크로 예치 완료",
          lines: [
            data.escrowId ? `escrow ${data.escrowId}` : "",
            data.lockedAmountBaseUnits ? `${baseUnitsToUsdc(data.lockedAmountBaseUnits)} USDC · ${data.network ?? ""}` : "",
            data.signature ? `서명 ${data.signature}` : "",
          ].filter(Boolean),
          agreementId: data.agreementId,
          explorerUrl: data.explorerUrl ?? null,
        }),
      );
    }

    case "escrow_skipped": {
      const data = event.data;
      return withColumn(state, data.creatorAgentId, (column) =>
        appendNote(column, {
          id: `escrow_skipped:${data.agreementId}`,
          kind: "escrow_skipped",
          title: `에스크로 보류 · ${data.status}`,
          lines: [data.reason ?? ""].filter(Boolean),
          agreementId: data.agreementId,
        }),
      );
    }

    case "escrow_failed": {
      const data = event.data;
      return withColumn(state, data.creatorAgentId, (column) =>
        appendNote(column, {
          id: `escrow_failed:${data.agreementId}`,
          kind: "escrow_failed",
          title: "에스크로 예치 실패",
          lines: [data.reason ?? "", data.detail ?? ""].filter(Boolean),
          agreementId: data.agreementId,
        }),
      );
    }

    case "campaign_result":
      return { ...state, phase: "done", result: event.data.result, error: null };

    case "error":
      return { ...state, phase: "error", error: event.data.detail };

    default:
      return state;
  }
}

function baseUnitsToUsdc(value: string) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return value;
  return (raw / 1_000_000).toLocaleString();
}

/* ---------- parsing ---------- */

export function parseCampaignStreamEvent(name: string, raw: string): CampaignStreamEvent | null {
  if (!(CAMPAIGN_STREAM_EVENT_NAMES as readonly string[]).includes(name)) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  // 서버 payload 형태는 campaignTypes.ts에 고정돼 있고 (by_alias 덤프), 이름으로
  // 판별되므로 여기서만 한 번 좁힌다.
  return { name: name as CampaignStreamEventName, data } as CampaignStreamEvent;
}

/* ---------- hook ---------- */

export function useCampaignStream() {
  const [state, dispatch] = useReducer(campaignStreamReducer, initialCampaignStreamState);
  const sourceRef = useRef<EventSource | null>(null);

  const stop = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const start = useCallback(
    (url: string) => {
      stop();
      dispatch({ type: "connecting" });
      const source = new EventSource(url);
      sourceRef.current = source;

      const handle = (name: CampaignStreamEventName) => (raw: Event) => {
        if (sourceRef.current !== source) return;
        const message = raw as MessageEvent<string>;
        const event = parseCampaignStreamEvent(name, message.data);
        if (!event) return;
        dispatch({ type: "event", event });
        if (event.name === "campaign_result" || event.name === "error") {
          // 스트림은 캠페인 1회로 끝난다. 열어 두면 EventSource가 재접속하며
          // 같은 프로모션으로 새 캠페인을 또 시작하므로 반드시 닫는다.
          source.close();
          sourceRef.current = null;
        }
      };

      for (const name of CAMPAIGN_STREAM_EVENT_NAMES) {
        if (name === "error") continue;
        source.addEventListener(name, handle(name));
      }
      // 서버의 `event: error`(data 있음)와 EventSource 자체의 연결 오류(data 없음)가
      // 같은 "error" 이벤트로 온다.
      source.addEventListener("error", (raw: Event) => {
        if (sourceRef.current !== source) return;
        const data = (raw as Partial<MessageEvent<string>>).data;
        if (typeof data === "string" && data) {
          handle("error")(raw);
          return;
        }
        source.close();
        sourceRef.current = null;
        dispatch({
          type: "connection_lost",
          detail:
            source.readyState === EventSource.CLOSED
              ? "캠페인 스트림에 연결하지 못했습니다. 백엔드가 떠 있는지, 프로모션 ID가 맞는지 확인해 주세요."
              : "캠페인 스트림 연결이 끊겼습니다. 진행 중이던 협상은 서버에서 계속될 수 있으니 프로모션 상세에서 결과를 확인해 주세요.",
        });
      });
    },
    [stop],
  );

  /** 사용자가 관전을 끊을 때. 서버의 캠페인은 계속될 수 있으므로 그 사실을 남긴다. */
  const cancel = useCallback(() => {
    stop();
    dispatch({
      type: "connection_lost",
      detail: "관전을 중단했습니다. 서버에서 진행 중이던 협상은 계속될 수 있으니 결과는 프로모션 상세에서 확인해 주세요.",
    });
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    dispatch({ type: "reset" });
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { state, start, cancel, reset };
}
