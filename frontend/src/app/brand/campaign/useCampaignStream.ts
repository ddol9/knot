"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { ProductApiError, runningCampaignIdFromProblem, toApiError } from "@/product/apiClient";
import { governanceReasonLabel } from "@/product/approvalTypes";
import {
  CAMPAIGN_STREAM_EVENT_NAMES,
  type BudgetLedgerSnapshot,
  type CampaignResult,
  type CampaignStreamEvent,
  type CampaignStreamEventName,
  type CampaignTurn,
  type DiscoveryReport,
  type NegotiationOutcome,
  type NegotiationSkipReason,
} from "@/product/campaignTypes";

/* ---------- view state ---------- */

export type CampaignPhase = "idle" | "connecting" | "running" | "done" | "error";

export type ColumnFinalKind = NegotiationOutcome | "SKIPPED" | "ERROR";

export type ColumnNote = {
  id: string;
  kind: "agreement" | "escrow_locked" | "escrow_skipped" | "escrow_failed" | "approval_required";
  title: string;
  lines: string[];
  agreementId?: string;
  approvalId?: string;
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

/** 시작 요청이 409 `CAMPAIGN_ALREADY_RUNNING`으로 거절됐을 때. campaignId는 detail 문장에서 뽑은 값(없을 수 있음). */
export type CampaignConflict = {
  code: string;
  campaignId: string | null;
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
  /** 취소 엔드포인트를 불렀고 `campaign_result`를 기다리는 중. */
  cancelRequested: boolean;
  /** 취소 요청 자체가 실패했을 때(스트림은 계속). */
  cancelError: string | null;
  conflict: CampaignConflict | null;
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
  cancelRequested: false,
  cancelError: null,
  conflict: null,
};

type Action =
  | { type: "reset" }
  | { type: "connecting" }
  | { type: "event"; event: CampaignStreamEvent }
  | { type: "connection_lost"; detail: string }
  | { type: "start_failed"; detail: string; code: string; runningCampaignId: string | null }
  | { type: "cancel_requested" }
  | { type: "cancel_failed"; detail: string };

/* ---------- labels (docs/18 어휘에 맞춘 한국어 카피) ---------- */

export const NEGOTIATION_OUTCOME_LABEL: Record<NegotiationOutcome, string> = {
  AGREED: "합의",
  REJECTED: "거절",
  ESCALATED: "사람 검토 필요",
  WALKED_AWAY: "상한 초과로 철수",
  ROUND_LIMIT: "라운드 초과",
  CANCELED: "브랜드 측 취소",
};

export const CAMPAIGN_OUTCOME_LABEL: Record<CampaignResult["outcome"], string> = {
  TARGET_REACHED: "목표 달성",
  PARTIAL: "일부 합의",
  NO_AGREEMENT: "합의 없음",
  NO_CANDIDATES: "후보 없음",
  CANCELED: "브랜드가 취소",
};

export const SKIP_REASON_LABEL: Record<NegotiationSkipReason, string> = {
  TARGET_REACHED: "목표 인원 도달로 시작하지 않음",
  BUDGET_EXHAUSTED: "예산 소진으로 시작하지 않음",
  CANCELED: "캠페인 취소로 시작하지 않음",
};

export const TURN_TYPE_LABEL: Record<CampaignTurn["type"], string> = {
  OFFER: "제안",
  COUNTER: "역제안",
  ACCEPT: "수락",
  REJECT: "거절",
  ESCALATE: "에스컬레이션",
};

function outcomeLabel(outcome: NegotiationOutcome, finalAmountUsdc: number | null, cancelRequested: boolean) {
  if (outcome === "AGREED") {
    return `합의 ${finalAmountUsdc?.toLocaleString() ?? "-"} USDC`;
  }
  if (outcome === "CANCELED") {
    // 브랜드 러너의 취소는 둘 중 하나다: 사람이 "관전 중단"을 눌렀거나, 목표 인원이 먼저 찼거나.
    return cancelRequested ? "브랜드 취소로 중단" : "목표 도달로 취소";
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
    case "start_failed":
      return {
        ...initialCampaignStreamState,
        phase: "error",
        error: action.detail,
        conflict:
          action.code === "CAMPAIGN_ALREADY_RUNNING" ? { code: action.code, campaignId: action.runningCampaignId } : null,
      };
    case "cancel_requested":
      if (state.phase !== "running") return state;
      return { ...state, cancelRequested: true, cancelError: null };
    case "cancel_failed":
      if (state.phase !== "running") return state;
      return { ...state, cancelRequested: false, cancelError: action.detail };
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
          label: SKIP_REASON_LABEL[event.data.reason] ?? `시작하지 않음 · ${event.data.reason}`,
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
        statusText: result.outcome === "CANCELED" ? "취소됨" : "종료",
        agreementId: result.agreementId ?? column.agreementId,
        final: {
          kind: result.outcome,
          label: outcomeLabel(result.outcome, result.finalAmountUsdc, state.cancelRequested),
        },
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

    case "approval_required": {
      // 거버넌스가 에스크로 락을 사람 뒤로 미뤘다. 합의는 유효하고 예산은 확정된 채로 멈춘다.
      const data = event.data;
      return withColumn(state, data.creatorAgentId, (column) =>
        appendNote(
          { ...column, agreementId: data.agreementId, statusText: "사람 승인 대기" },
          {
            id: `approval_required:${data.approvalId}`,
            kind: "approval_required",
            title: "🙋 사람 승인 대기",
            lines: [
              `${data.amountUsdc.toLocaleString()} USDC · 캠페인 누적 ${data.campaignCommittedUsdc.toLocaleString()} USDC`,
              ...data.reasons.map(governanceReasonLabel),
              `${data.ruleVersion} · ${data.approvalId}`,
            ],
            agreementId: data.agreementId,
            approvalId: data.approvalId,
          },
        ),
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

export type SseMessage = { event: string; data: string };

/**
 * `text/event-stream` 바이트를 메시지로 자르는 최소 파서. EventSource 대신 fetch를 쓰는 이유:
 * 시작 요청의 409(`CAMPAIGN_ALREADY_RUNNING`) 본문을 읽어야 하고, 끝난 스트림에 자동 재접속해
 * 같은 프로모션 캠페인을 또 띄우면 안 되기 때문.
 */
export function createSseParser() {
  let buffer = "";
  let event = "message";
  let data: string[] = [];

  const flush = (out: SseMessage[]) => {
    if (data.length > 0) out.push({ event, data: data.join("\n") });
    event = "message";
    data = [];
  };

  return {
    push(chunk: string): SseMessage[] {
      const out: SseMessage[] = [];
      buffer += chunk.replace(/\r\n?/g, "\n");
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line === "") flush(out);
        else if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        // `:` 주석, id:, retry: 는 무시한다.
        index = buffer.indexOf("\n");
      }
      return out;
    },
  };
}

/* ---------- hook ---------- */

export type UseCampaignStreamOptions = {
  /** "관전 중단" → 서버 취소. 실패하면 reject; 스트림은 그대로 둔다. */
  cancelCampaign?: (campaignId: string) => Promise<unknown>;
};

const CONNECT_FAILED =
  "캠페인 스트림에 연결하지 못했습니다. 백엔드가 떠 있는지, 프로모션 ID가 맞는지 확인해 주세요.";
const CONNECTION_LOST =
  "캠페인 스트림 연결이 끊겼습니다. 진행 중이던 협상은 서버에서 계속될 수 있으니 프로모션 상세에서 결과를 확인해 주세요.";

export function useCampaignStream(options: UseCampaignStreamOptions = {}) {
  const [state, dispatch] = useReducer(campaignStreamReducer, initialCampaignStreamState);
  const controllerRef = useRef<AbortController | null>(null);
  const campaignIdRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const start = useCallback(
    (url: string) => {
      stop();
      dispatch({ type: "connecting" });
      campaignIdRef.current = null;
      const controller = new AbortController();
      controllerRef.current = controller;
      const live = () => controllerRef.current === controller;
      const finish = () => {
        if (live()) controllerRef.current = null;
      };

      void (async () => {
        let response: Response;
        try {
          response = await fetch(url, {
            signal: controller.signal,
            cache: "no-store",
            headers: { Accept: "text/event-stream" },
          });
        } catch {
          if (!live()) return;
          finish();
          dispatch({ type: "connection_lost", detail: CONNECT_FAILED });
          return;
        }
        if (!live()) return;

        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null);
          if (!live()) return;
          finish();
          const error = toApiError(response.status, body);
          dispatch({
            type: "start_failed",
            detail: error.message,
            code: error.code,
            runningCampaignId: error.code === "CAMPAIGN_ALREADY_RUNNING" ? runningCampaignIdFromProblem(body) : null,
          });
          return;
        }
        if (!response.body) {
          finish();
          dispatch({ type: "connection_lost", detail: CONNECT_FAILED });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser();
        let ended = false;
        try {
          while (live()) {
            const { value, done } = await reader.read();
            if (!live()) return;
            if (done) break;
            for (const message of parser.push(decoder.decode(value, { stream: true }))) {
              const event = parseCampaignStreamEvent(message.event, message.data);
              if (!event) continue;
              if (event.name === "status") campaignIdRef.current = event.data.campaignId;
              dispatch({ type: "event", event });
              if (event.name === "campaign_result" || event.name === "error") {
                // 스트림은 캠페인 1회로 끝난다. 결과를 받으면 바로 닫는다.
                ended = true;
                break;
              }
            }
            if (ended) break;
          }
        } catch {
          if (!live()) return;
        } finally {
          if (live()) {
            controller.abort();
            finish();
            if (!ended) dispatch({ type: "connection_lost", detail: CONNECTION_LOST });
          }
        }
      })();
    },
    [stop],
  );

  /**
   * "관전 중단": 서버 캠페인을 취소하고 `campaign_result`(CANCELED 또는 이미 생긴 합의 반영)가
   * 올 때까지 스트림은 열어 둔다. 아직 campaignId를 모르면(연결 직후) 그냥 끊는다.
   */
  const cancel = useCallback(() => {
    const campaignId = campaignIdRef.current;
    const request = optionsRef.current.cancelCampaign;
    if (!campaignId || !request || !controllerRef.current) {
      stop();
      dispatch({
        type: "connection_lost",
        detail: "관전을 중단했습니다. 서버에서 진행 중이던 협상은 계속될 수 있으니 결과는 프로모션 상세에서 확인해 주세요.",
      });
      return;
    }
    dispatch({ type: "cancel_requested" });
    request(campaignId).catch((caught: unknown) => {
      if (campaignIdRef.current !== campaignId) return;
      const detail = caught instanceof ProductApiError || caught instanceof Error ? caught.message : String(caught);
      dispatch({ type: "cancel_failed", detail: `취소 요청이 실패했습니다: ${detail}` });
    });
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    campaignIdRef.current = null;
    dispatch({ type: "reset" });
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { state, start, cancel, reset };
}
