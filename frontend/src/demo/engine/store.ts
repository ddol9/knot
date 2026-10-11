/**
 * 데모 스토어 — 브랜드 창(host)이 대본을 굴리고, 크리에이터 창(mirror)이 미러링.
 *
 * 동기화: 매 커밋마다 전체 상태를 localStorage에 쓰고 BroadcastChannel로 쏜다.
 * 상태가 작아서(수십 KB) 디프 없이 전체 스냅샷이 가장 단순하고 안전하다.
 */

import { useSyncExternalStore } from "react";
import { openReport } from "@/demo/reportClient";
import { withBase } from "@/demo/ui/asset";
import {
  createRealPromotionAndAgreement,
  fundRealEscrow,
  pickEvidenceMilestoneId,
  registerCreatorWallet,
  submitRealEvidence,
} from "@/demo/real/apiFlow";
import type { ChatChip, DemoAction, DemoState, RealChainState, SequenceStep } from "./types";
import {
  autopilotSequence,
  BUDGET_PRESETS,
  buildBrandProfile,
  composeFlowFor,
  DEFAULT_BUDGET,
  enterWorkspaceSequence,
  expeditionSequence,
  HERO_ID,
  knotSequence,
  nextId,
  postSubmittedSequence,
  REPORT_SUMMARY,
  scanSequence,
} from "./script";

const LS_KEY = "knot-demo-state-v2"; // v1: 무드빔 목업 시절 상태 — 키 승격으로 전면 초기화
const CHANNEL = "knot-demo-v1";

function initialState(): DemoState {
  return {
    v: 0,
    stage: "intro",
    scan: null,
    brand: null,
    chat: [],
    agentTyping: false,
    composeStep: "idle",
    pendingBudget: null,
    campaign: null,
    feed: [],
    autopilot: false,
    autopilotRun: null,
    // 앰비언트 오퍼 — 크리에이터가 로그인해두면 원래도 딜이 흐르고 있다는 느낌
    inboundOffers: [
      {
        id: "offer-greenity",
        brandName: "그리니티",
        brandLogo: "🌿",
        amountUsdc: 180,
        format: "스킨케어 리뷰 릴스",
        status: "new",
        note: "루프가 조건 검토 중",
        at: Date.now() - 1000 * 60 * 60 * 5,
      },
      {
        id: "offer-lumen",
        brandName: "루먼",
        brandLogo: "💨",
        amountUsdc: 320,
        format: "전자담배 디바이스 언박싱",
        status: "declined",
        note: "금지 카테고리(담배) — 자동 거절",
        at: Date.now() - 1000 * 60 * 60 * 26,
      },
    ],
    creatorWalletUsdc: 1240,
    burstSeq: 0,
    real: null,
  };
}

let state: DemoState = initialState();
let channel: BroadcastChannel | null = null;
let role: "host" | "mirror" = "mirror";
const listeners = new Set<() => void>();
const timers = new Set<ReturnType<typeof setTimeout>>();

function notify() {
  listeners.forEach((l) => l());
}

function persistAndBroadcast() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // 저장 실패해도 데모는 계속 — 채널이 있으면 미러는 산다.
  }
  channel?.postMessage({ t: "state", s: state });
}

function commit(next: DemoState) {
  next.v = state.v + 1;
  state = next;
  persistAndBroadcast();
  notify();
}

export function mutate(action: DemoAction) {
  const draft = structuredClone(state);
  action(draft);
  commit(draft);
}

/** 대본 스텝을 순차 재생. 여러 시퀀스가 동시에 돌 수 있다(채팅 답변 + 탐험). */
export function playSequence(steps: SequenceStep[], onDone?: () => void) {
  let i = 0;
  const tick = () => {
    if (i >= steps.length) {
      onDone?.();
      return;
    }
    const s = steps[i];
    i += 1;
    const t = setTimeout(() => {
      timers.delete(t);
      mutate(s.run);
      tick();
    }, s.d);
    timers.add(t);
  };
  tick();
}

export function initDemo(mode: "host" | "mirror") {
  role = mode;
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(LS_KEY);
    // 이전 버전 상태에 없는 필드는 초기값으로 채운다 (배포 갱신 후 미러 크래시 방지)
    if (raw) {
      state = { ...initialState(), ...(JSON.parse(raw) as DemoState) };
      // 구버전 brand에는 intro/images가 없다 — 기본값으로 채워서 머지
      if (state.brand) {
        state.brand.intro ??= "";
        state.brand.images ??= [];
      }
    }
  } catch {
    state = initialState();
  }
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e: MessageEvent) => {
      const msg = e.data as { t: string; s?: DemoState; kind?: string; url?: string };
      if (msg.t === "state" && role === "mirror" && msg.s) {
        state = msg.s;
        notify();
      }
      if (msg.t === "hello" && role === "host") {
        persistAndBroadcast();
      }
      // 미러(크리에이터 창)가 보내는 행동 — 호스트만 처리한다.
      if (msg.t === "action" && role === "host") {
        if (msg.kind === "submitPost" && msg.url) handleSubmitPost(msg.url);
      }
    };
  }
  if (mode === "mirror") channel.postMessage({ t: "hello" });
  notify();
}

export function resetDemo() {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  commit(initialState());
}

const serverSnapshot = initialState();

export function useDemo(): DemoState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => serverSnapshot,
  );
}

/* ------------------------------ 사용자 액션 (host) ------------------------------ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startScan(url: string) {
  playSequence(scanSequence(url));
  void finishScan(url);
}

/**
 * 실제 사이트 스캔 — /api/knot/scan이 진짜 프로필을 주면 그걸 쓰고,
 * 실패하면 힌트 병합 → 결정론 목업 순으로 폴백한다.
 * Cloud Run 콜드스타트 + Vertex로 22초를 넘기는 경우가 실제로 있어서
 * 타임아웃 60초 + 실패 시 1회 재시도. 결과가 도착하면 brand를 먼저 확정하고
 * 추출 카드를 400ms 간격으로 공개한 뒤 부화로 넘어간다.
 */
async function fetchBrandProfile(url: string, fallback: ReturnType<typeof buildBrandProfile>) {
  const res = await fetch(withBase("/api/knot/scan"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await res.json()) as {
    ok: boolean;
    profile?: {
      name: string;
      tagline: string;
      intro?: string;
      tone: string[];
      products: { name: string; desc: string }[];
      audience: string;
      color: string;
    };
    logo?: string | null;
    images?: string[];
    finalUrl?: string;
    hints?: { title?: string | null; description?: string | null; siteName?: string | null; logo?: string | null } | null;
  };
  const domain = (data.finalUrl ?? url)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  const images = (data.images ?? []).slice(0, 8);
  if (data.ok && data.profile) {
    const p = data.profile;
    return {
      url: domain || fallback.url,
      name: p.name || fallback.name,
      tagline: p.tagline || fallback.tagline,
      intro: p.intro || fallback.intro,
      tone: (p.tone ?? []).slice(0, 3).length ? p.tone.slice(0, 3) : fallback.tone,
      products: (p.products ?? []).slice(0, 4).length ? p.products.slice(0, 4) : fallback.products,
      audience: p.audience || fallback.audience,
      images,
      color: /^#[0-9a-f]{6}$/i.test(p.color ?? "") ? p.color : fallback.color,
      logo: data.logo || fallback.logo,
      agentName: fallback.agentName,
    };
  }
  if (data.hints) {
    // LLM 없이도 실제 사이트 정보는 반영
    return {
      ...fallback,
      url: domain || fallback.url,
      name: data.hints.siteName || data.hints.title?.split(/[|·—-]/)[0].trim() || fallback.name,
      tagline: data.hints.description?.slice(0, 40) || fallback.tagline,
      intro: data.hints.description || fallback.intro,
      images,
      logo: data.hints.logo || fallback.logo,
    };
  }
  return fallback;
}

async function finishScan(url: string) {
  const fallback = buildBrandProfile(url);
  let profile = fallback;

  const request = (async () => {
    try {
      profile = await fetchBrandProfile(url, fallback);
    } catch {
      try {
        profile = await fetchBrandProfile(url, fallback); // 콜드스타트 타임아웃 대비 1회 재시도
      } catch {
        // 재시도까지 실패 → 목업 폴백
      }
    }
  })();

  await Promise.all([request, sleep(3600)]);
  // 실데이터 도착 — 브랜드 확정 후 카드 5장 순차 공개 → 부화
  mutate((d) => {
    d.brand = profile;
    if (d.scan) d.scan.step = 0;
  });
  const reveal: SequenceStep[] = [];
  for (let i = 1; i <= 5; i += 1) {
    reveal.push({
      d: 400,
      run: (d) => {
        if (d.scan) d.scan.step = i;
      },
    });
  }
  reveal.push({
    d: 700,
    run: (d) => {
      if (d.scan) d.scan.done = true;
      d.stage = "hatch";
    },
  });
  playSequence(reveal);
}

export function hatchDone() {
  playSequence(enterWorkspaceSequence());
}

function askNext(
  q: { question: string; chips: readonly ChatChip[] },
  step: DemoState["composeStep"],
) {
  playSequence([
    {
      d: 350,
      run: (d) => {
        d.agentTyping = true;
      },
    },
    {
      d: 1000,
      run: (d) => {
        d.agentTyping = false;
        d.composeStep = step;
        d.chat.push({
          id: nextId(),
          role: "agent",
          text: q.question,
          chips: q.chips.map((c) => ({ ...c })),
          at: Date.now(),
        });
      },
    },
  ]);
}

export function clickChip(chip: ChatChip) {
  mutate((d) => {
    for (const m of d.chat) if (m.chips) delete m.chips;
    d.chat.push({ id: nextId(), role: "user", text: chip.label, at: Date.now() });
    if (chip.id.startsWith("budget-")) d.pendingBudget = BUDGET_PRESETS[chip.id] ?? d.pendingBudget;
  });
  const flow = composeFlowFor(state.brand);
  if (chip.id === "start-campaign") askNext(flow.goal, "goal");
  else if (chip.id.startsWith("goal-")) askNext(flow.budget, "budget");
  else if (chip.id.startsWith("budget-")) askNext(flow.content, "content");
  else if (chip.id.startsWith("content-")) {
    const spec = state.pendingBudget ?? DEFAULT_BUDGET;
    askNext(composeFlowFor(state.brand, spec).confirm, "confirm");
  } else if (chip.id === "launch-expedition") {
    playSequence(expeditionSequence(state.brand, state.pendingBudget ?? DEFAULT_BUDGET));
    void startRealChain();
  } else if (chip.id === "toggle-autopilot") playSequence(autopilotSequence(state.brand));
  else if (chip.id === "open-report") openReport(state); // 새 탭은 클릭 시점에 — 팝업 차단 회피
}

/**
 * 예산 직접 입력 — 프리셋 칩과 동일한 경로. ChatDock의 "직접 입력" 폼이 호출한다.
 * 딜당 한도가 총예산을 넘는 건 검증(캡 ≤ 총예산)에서 이미 막혔다고 가정한다.
 */
export function submitBudget(budgetUsdc: number, maxPerDealUsdc: number) {
  mutate((d) => {
    for (const m of d.chat) if (m.chips) delete m.chips;
    d.chat.push({
      id: nextId(),
      role: "user",
      text: `총 ${budgetUsdc.toLocaleString()} · 딜당 ${maxPerDealUsdc.toLocaleString()}`,
      at: Date.now(),
    });
    d.pendingBudget = { budgetUsdc, maxPerDealUsdc };
  });
  askNext(composeFlowFor(state.brand).content, "content");
}

/** 오토파일럿 토글 — 끄면 진행 중인 런 카드도 같이 치운다. */
export function setAutopilot(on: boolean) {
  mutate((d) => {
    d.autopilot = on;
    if (!on) d.autopilotRun = null;
  });
}

export function approveDeals() {
  playSequence(knotSequence(state.brand));
}

/** 호스트에서 실행 — 게시물 검증 시퀀스 시작 (중복 제출 가드). */
function handleSubmitPost(url: string) {
  const hero = state.campaign?.deals.find((d) => d.creatorId === HERO_ID);
  if (!hero?.awaitingPost) return;
  playSequence(postSubmittedSequence(url, state.brand));
  void submitRealEvidenceForChain(url);
}

/** 크리에이터 창에서 호출 — 게시물 URL 제출. 미러면 호스트로 보낸다. */
export function submitPost(url: string) {
  if (role === "host") {
    handleSubmitPost(url);
  } else {
    channel?.postMessage({ t: "action", kind: "submitPost", url });
  }
}

/**
 * 자유 입력 — /api/knot/chat(진짜 LLM)으로 대답하고,
 * 키가 없거나 실패하면 결정론 상태 응답으로 폴백한다.
 */
let lastFreeText = { text: "", at: 0 };
let answeringFreeText = false;

export function sendFreeText(text: string) {
  // 이중 답장 방어: 입력 핸들러가 같은 텍스트를 연속 발화하면(2초 내) 무시
  const now = Date.now();
  if (text === lastFreeText.text && now - lastFreeText.at < 2000) return;
  lastFreeText = { text, at: now };
  mutate((d) => {
    d.chat.push({ id: nextId(), role: "user", text, at: Date.now() });
    d.agentTyping = true;
  });
  void answerFreeText();
}

function chatContextSummary() {
  const c = state.campaign;
  return {
    brand: state.brand
      ? {
          name: state.brand.name,
          agentName: state.brand.agentName,
          url: state.brand.url,
          tone: state.brand.tone,
          intro: state.brand.intro,
          products: state.brand.products,
        }
      : null,
    campaign: c
      ? {
          status: c.status,
          goal: c.spec.goal,
          budgetUsdc: c.spec.budgetUsdc,
          maxPerDealUsdc: c.spec.maxPerDealUsdc,
          negotiations: Object.values(c.negotiations).map((n) => ({
            creatorId: n.creatorId,
            status: n.status,
            agreedUsdc: n.agreedUsdc,
            blockedReason: n.blockedReason,
          })),
          deals: c.deals.map((d) => ({
            creatorId: d.creatorId,
            amountUsdc: d.amountUsdc,
            bonusUsdc: d.bonusUsdc,
            progressPct: d.starPct,
            awaitingPost: d.awaitingPost,
            postUrl: d.postUrl,
            metrics: d.metrics,
            milestones: d.milestones.map((m) => ({ label: m.label, usdc: m.usdc, status: m.status })),
          })),
          report: c.reportReady ? REPORT_SUMMARY : null,
        }
      : null,
    autopilot: state.autopilot,
  };
}

async function answerFreeText() {
  if (answeringFreeText) return; // 중복 실행 방지 — 답장은 한 번만
  answeringFreeText = true;
  try {
    await answerFreeTextInner();
  } finally {
    answeringFreeText = false;
  }
}

async function answerFreeTextInner() {
  const turns = state.chat
    .slice(-14)
    .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.text }));
  try {
    const res = await fetch(withBase("/api/knot/chat"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turns, context: chatContextSummary() }),
      signal: AbortSignal.timeout(45_000),
    });
    const data = (await res.json()) as { ok: boolean; text?: string; action?: string | null };
    if (data.ok && data.text) {
      // 리포트는 칩 클릭 시점에 새 탭으로 — 비동기 응답에서 바로 열면 팝업 차단에 걸린다
      const chips: ChatChip[] | undefined =
        data.action === "OPEN_REPORT" && state.campaign?.deals.length
          ? [{ id: "open-report", label: "📊 리포트 열기" }]
          : undefined;
      mutate((d) => {
        d.agentTyping = false;
        d.chat.push({ id: nextId(), role: "agent", text: data.text!, chips, at: Date.now() });
      });
      if (data.action === "START_CAMPAIGN" && !state.campaign && state.composeStep !== "goal") {
        askNext(composeFlowFor(state.brand).goal, "goal");
      }
      return;
    }
  } catch {
    // LLM 실패 → 결정론 폴백
  }
  const reply = composeStatusReply();
  mutate((d) => {
    d.agentTyping = false;
    d.chat.push({ id: nextId(), role: "agent", text: reply, at: Date.now() });
  });
}

function composeStatusReply(): string {
  const c = state.campaign;
  if (!c) {
    return "아직 진행 중인 캠페인이 없어요. 위의 선택지로 하나 만들어주시면 제가 탐험 다녀올게요.";
  }
  switch (c.status) {
    case "scouting":
      return `지금 크리에이터 네트워크 스캔 중이에요 — ${c.discovered.length}명 발견했어요. 적합도 계산이 끝나면 바로 협상 들어갑니다.`;
    case "negotiating": {
      const agreed = Object.values(c.negotiations).filter((n) => n.status === "agreed").length;
      return `협상 진행 중이에요. 지금까지 ${agreed}건 체결했고, 나머지도 한도 ${c.spec.maxPerDealUsdc} 안에서 조율하고 있어요. 협상 로그는 캠페인 화면에서 실시간으로 보실 수 있어요.`;
    }
    case "pending_approval": {
      const agreed = Object.values(c.negotiations).filter((n) => n.status === "agreed").length;
      return `딜 ${agreed}건 물어와서 승인 기다리는 중이에요. 캠페인 화면에서 조건 확인하고 승인해 주세요.`;
    }
    case "knotting":
      return "지금 매듭 묶는 중이에요 — 에스크로 예치까지 몇 초면 끝나요.";
    case "active": {
      const hero = c.deals.find((d) => d.creatorId === HERO_ID);
      return `진행 중이에요. 씬님 별 게이지 ${hero?.starPct ?? 0}%, 에스크로에서 마일스톤 따라 자동 릴리즈되고 있어요. 저는 검증만 잘 지켜보면 됩니다.`;
    }
    case "completed":
      return "캠페인 끝났어요! 리포트 요약은 위에 드렸고, 자세한 건 캠페인 화면 리포트 탭에 있어요.";
    default:
      return "확인해볼게요.";
  }
}

/* ------------------------------ 실시간 devnet 증빙 ------------------------------ */

function initialRealChain(): RealChainState {
  return {
    status: "idle",
    promotionId: null,
    agreementId: null,
    creatorAgentId: null,
    escrowId: null,
    amountUsdc: null,
    network: "devnet",
    brandWallet: null,
    creatorWallet: null,
    fundingSignature: null,
    releaseSignature: null,
    milestoneId: null,
    error: null,
  };
}

function readableRealError(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  return String(caught);
}

/**
 * 대본(feed/txHash)과 별개로 진짜 백엔드에 프로모션을 만들고 agent-run(진짜
 * discovery+pay.sh 검증+협상)까지 돌린다. 실패해도 대본 연출은 그대로 진행된다 —
 * 여기서 던지는 에러는 RealChainCard에만 노출된다.
 */
export async function startRealChain(): Promise<void> {
  if (!state.brand) return;
  if (state.real && state.real.status !== "idle" && state.real.status !== "error") return;
  const budget = state.pendingBudget ?? DEFAULT_BUDGET;
  const brand = state.brand;
  mutate((d) => {
    d.real = { ...initialRealChain(), status: "creating" };
  });
  try {
    const { promotionId, run } = await createRealPromotionAndAgreement(brand, {
      goal: "브랜드 제품 협찬 캠페인",
      contentType: "reel",
      budgetUsdc: budget.budgetUsdc,
      maxPerDealUsdc: budget.maxPerDealUsdc,
      deadlineLabel: "2주",
    });
    mutate((d) => {
      if (!d.real) return;
      d.real.promotionId = promotionId;
      if (run.agreement) {
        d.real.status = "agreed";
        d.real.agreementId = run.agreement.agreementId;
        d.real.creatorAgentId = run.agreement.creatorAgentId;
        d.real.amountUsdc = run.agreement.terms.compensation.baseAmountUsdc;
        d.real.milestoneId = pickEvidenceMilestoneId(run.agreement);
      } else {
        d.real.status = "waiting_creator";
      }
    });
  } catch (caught) {
    mutate((d) => {
      if (!d.real) return;
      d.real.status = "error";
      d.real.error = readableRealError(caught);
    });
  }
}

/** 브랜드 창에서 호출 — Phantom 지갑 연결 후 실제 devnet 예치 트랜잭션에 서명. */
export async function fundRealChainEscrow(): Promise<void> {
  const agreementId = state.real?.agreementId;
  if (!agreementId) return;
  mutate((d) => {
    if (d.real) d.real.status = "funding";
  });
  try {
    const { signature, brandWallet } = await fundRealEscrow(agreementId);
    mutate((d) => {
      if (!d.real) return;
      d.real.status = "funded";
      d.real.fundingSignature = signature;
      d.real.brandWallet = brandWallet;
    });
  } catch (caught) {
    mutate((d) => {
      if (!d.real) return;
      d.real.status = "agreed";
      d.real.error = readableRealError(caught);
    });
  }
}

/** 크리에이터 창에서 호출 — 정산 받을 Phantom 지갑을 소유 증명과 함께 등록. */
export async function connectRealCreatorWallet(): Promise<void> {
  try {
    const address = await registerCreatorWallet();
    mutate((d) => {
      if (d.real) d.real.creatorWallet = address;
    });
  } catch (caught) {
    mutate((d) => {
      if (d.real) d.real.error = readableRealError(caught);
    });
  }
}

/**
 * 크리에이터가 게시물 URL을 제출하면(대본과 별개로) 실제 evidence 제출+검증을 시도한다.
 * 통과하면 서버(KNOT_SETTLEMENT_AUTHORITY)가 자동으로 devnet에 릴리즈 트랜잭션을 서명·전송한다.
 */
async function submitRealEvidenceForChain(url: string) {
  const real = state.real;
  if (!real?.agreementId || !real.creatorAgentId || !real.milestoneId) return;
  if (real.status !== "funded") return; // 예치 전엔 증빙을 붙일 온체인 대상이 없다
  mutate((d) => {
    if (d.real) d.real.status = "submitting_evidence";
  });
  try {
    const verified = await submitRealEvidence(
      { agreementId: real.agreementId, creatorAgentId: real.creatorAgentId },
      real.milestoneId,
      url,
    );
    const signature = verified.autoSettlement?.released
      ? verified.autoSettlement.settlement?.signature ?? null
      : null;
    mutate((d) => {
      if (!d.real) return;
      if (signature) {
        d.real.status = "released";
        d.real.releaseSignature = signature;
      } else {
        d.real.status = "funded";
        d.real.error = verified.outcome
          ? `증빙 판정: ${verified.outcome} — 자동 정산 대기`
          : "증빙 검증은 됐지만 자동 정산이 아직 안 됐어요.";
      }
    });
  } catch (caught) {
    mutate((d) => {
      if (!d.real) return;
      d.real.status = "funded";
      d.real.error = readableRealError(caught);
    });
  }
}
