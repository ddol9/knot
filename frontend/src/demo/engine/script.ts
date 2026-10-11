/**
 * 라이브 데모 대본 — 등장인물, 대사, 타이밍 전부 여기서 결정된다.
 *
 * 원칙 (docs/24_UX_JOURNEY_v1.md 계승):
 *  - 금액·판정은 결정론. 대사는 그 값을 읽어 만든 문장. 둘이 어긋나면 버그.
 *  - 모든 에이전트 발화에는 reasoning(왜 이 판단인지)이 붙을 수 있고,
 *    한도(사람이 정한 숫자)가 결말을 가른다: 400 ≤ 450 체결, 800 > 450 차단.
 */

import type {
  BrandProfile,
  CampaignSpec,
  ChatChip,
  CreatorCard,
  DemoState,
  FeedTone,
  InboundOffer,
  SequenceStep,
  TaskBrief,
} from "./types";

let seq = 0;
export const nextId = () => `d${(seq += 1)}`;

/* ---------------------------------- 캐스트 --------------------------------- */

export const HERO_ID = "ssin";

export const CREATORS: CreatorCard[] = [
  {
    id: "ssin",
    handle: "@ssin",
    name: "ssin 씬기록",
    color: "#e8896b",
    photo: "/demo/ssin.jpg",
    followers: "100만",
    engagement: "5.8%",
    niche: "뷰티 크리에이터",
    fit: 94,
    fitReason: "뷰티 무드 정합 최상 · 평균 조회수 7만 · 전환형 시청층",
    profileUrl: "youtube.com/@ssin",
    insights: { avgViews: "7만", saves30d: "4,200", growth30d: "+2.8%", topFormat: "메이크업 튜토리얼" },
  },
  {
    id: "geekble",
    handle: "@geekble_kr",
    name: "긱블 Geekble",
    color: "#7ba05b",
    photo: "/demo/geekble.jpg",
    followers: "120만",
    engagement: "6.1%",
    niche: "테크 · 공학 콘텐츠",
    fit: 88,
    fitReason: "평균 조회수 28.6만 · CPM 효율 최상 · 제작 슬롯 여유",
    profileUrl: "youtube.com/@geekble_kr",
    insights: { avgViews: "28.6만", saves30d: "9,800", growth30d: "+4.6%", topFormat: "공학 실험 · 제작기" },
  },
  {
    id: "risabae",
    handle: "@RISABAE",
    name: "RISABAE",
    color: "#6b7fd7",
    photo: "/demo/risabae.jpg",
    followers: "268만",
    engagement: "3.4%",
    niche: "뷰티 프리미엄",
    fit: 76,
    fitReason: "구독 268만 메가 채널 · 평균 조회수 12만 · 단가 프리미엄 예상",
    profileUrl: "youtube.com/@RISABAE",
    insights: { avgViews: "12만", saves30d: "6,100", growth30d: "+0.9%", topFormat: "커버 메이크업" },
  },
];

export const creatorById = (id: string) =>
  CREATORS.find((c) => c.id === id) ?? CREATORS[0];

/** 오토파일럿이 자동 체결하는 캐스트 — 탐험 대상은 아니라 CREATORS 밖 */
export const AUTOPILOT_CREATOR = {
  id: "jocoding",
  handle: "@jocoding",
  name: "조코딩 JoCoding",
  color: "#b58cd9",
  photo: "/demo/jocoding.jpg",
  niche: "테크 · 코딩",
  fit: 82,
  amountUsdc: 220,
};

/** 크리에이터 창의 주인공(씬님)이 정해둔 규칙 — /c 화면에 항상 노출 */
export const HERO_RULES = {
  agentName: "루프",
  minUsdc: 400,
  weeklySlots: "주 1건",
  blocked: ["도박", "담배", "고금리 대출"],
  bonusAsk: "조회수 15만 초과 시 +10% 보너스 조항 요구",
};

/** 완주 리포트의 결정론 수치 — 대사·리포트 카드·챗 컨텍스트가 전부 이 값을 읽는다 */
export const REPORT_SUMMARY = {
  totalViews: "44.6만", // 씬님 18.2만 + 긱블 26.4만
  targetViews: "30만",
  totalSaves: "3,840", // 씬님 1,540 + 긱블 2,300
  cpmVsIndustry: "-27%",
  spentUsdc: 700, // 400 + 보너스 40 + 260
  budgetUsdc: 1000,
  savedPct: 30,
};

/** URL에서 "추출"되는 브랜드 프로필 — 데모 기본값은 무드빔 */
export function buildBrandProfile(url: string): BrandProfile {
  const domain = url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  const isDefault = /moodbeam|무드빔/i.test(domain) || domain.length === 0;
  const fallbackName = domain.split(".")[0] || "moodbeam";
  if (isDefault) {
    // 데모 기본 브랜드(무드빔)일 때만 풀 목업을 쓴다.
    return {
      url: domain || "moodbeam.kr",
      name: "무드빔",
      tagline: "방의 공기를 바꾸는 조명",
      intro:
        "방의 분위기를 바꾸는 조명을 만드는 팀입니다. 달빛과 노을을 모티프로, 1인 가구의 저녁 시간을 디자인합니다.",
      tone: ["따뜻한", "미니멀", "저녁의"],
      products: [
        { name: "문라이트 램프", desc: "달빛 색온도 재현 무드등" },
        { name: "선셋 프로젝터", desc: "노을 그라데이션 프로젝션" },
      ],
      audience: "1인 가구 · 인테리어 감성 20-34",
      images: [],
      color: "#d9a441",
      logo: "/demo/moodbeam.svg",
      agentName: "타래",
    };
  }
  // 실제 URL인데 스캔/LLM이 실패한 경우 — 다른 브랜드의 목업(조명 제품 등)을
  // 절대 뒤집어씌우지 않는다. 이름만 도메인에서 따고 나머지는 비워서 정직하게.
  return {
    url: domain,
    name: fallbackName.charAt(0).toUpperCase() + fallbackName.slice(1),
    tagline: "",
    intro: "",
    tone: [],
    products: [],
    audience: "",
    images: [],
    color: "#d9a441",
    logo: "/icon.svg",
    agentName: "타래",
  };
}

/* --------------------------- 브랜드 기반 대사 헬퍼 --------------------------- */
/* 캠페인 플로우의 모든 브랜드 언급은 실제 스캔된 brand에서 만든다 — 고정 문구 금지. */

/** 브랜드 계정 핸들 — 도메인 첫 파트 (moodbeam.kr → @moodbeam) */
export const brandHandle = (brand: Pick<BrandProfile, "url"> | null | undefined) =>
  (brand?.url ?? "").split(".")[0] || "brand";

const brandName = (brand: BrandProfile | null) => brand?.name ?? "브랜드";
const agentName = (brand: BrandProfile | null) => brand?.agentName ?? "타래";
const productName = (brand: BrandProfile | null, i = 0) =>
  brand?.products[i]?.name ?? brand?.products[0]?.name ?? "신제품";

export const CAMPAIGN_SPEC: CampaignSpec = {
  goal: "신제품 런칭 붐업",
  contentType: "릴스 1개 (30초 내외)",
  budgetUsdc: 1000,
  maxPerDealUsdc: 450,
  deadlineLabel: "2주 안에",
};

/** 예산 칩 → 실제 스펙 값. id는 composeFlowFor().budget.chips와 1:1. */
export const BUDGET_PRESETS: Record<string, { budgetUsdc: number; maxPerDealUsdc: number }> = {
  "budget-500": { budgetUsdc: 500, maxPerDealUsdc: 300 },
  "budget-1000": { budgetUsdc: 1000, maxPerDealUsdc: 450 },
  "budget-2000": { budgetUsdc: 2000, maxPerDealUsdc: 600 },
};

export const DEFAULT_BUDGET = BUDGET_PRESETS["budget-1000"];

/**
 * 크리에이터별 협상 성향 — floor(양보 못 하는 최소 단가)와 브랜드의 시작 제안 비율.
 * 딜당 한도(cap)가 floor보다 낮으면 정책이 차단한다: 이게 "자율성의 경계" 그 자체라
 * 사람이 한도를 바꾸면 결과(체결/차단)가 실제로 바뀌어야 한다.
 */
const NEGOTIATION_TRAITS: Record<string, { floor: number; openRatio: number }> = {
  geekble: { floor: 250, openRatio: 0.58 },
  ssin: { floor: 400, openRatio: 0.71 },
  risabae: { floor: 800, openRatio: 0.76 },
};

const round10 = (n: number) => Math.max(10, Math.round(n / 10) * 10);
const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

type NegotiationOutcome = {
  cap: number;
  floor: number;
  opening: number;
  agreed: boolean;
  amount: number;
  blockReason: "cap" | "budget" | null;
};

const roundMoney = (n: number) => (n >= 100 ? Math.round(n / 10) * 10 : Math.max(1, Math.round(n)));

type BlockReason = "cap" | "budget" | null;

function negotiate(creatorId: string, cap: number, remainingBudget: number): NegotiationOutcome {
  const trait = NEGOTIATION_TRAITS[creatorId];
  // 기준선은 한도에 비례해 스케일된다(앵커 450 — 프리셋에선 기존 250/400/800 그대로).
  // 20 USDC 지갑 같은 실예산에서도 "체결 + 차단" 서사가 유지된다.
  const floor = Math.min(trait.floor, roundMoney((cap * trait.floor) / 450));
  const opening = roundMoney(Math.min(cap, remainingBudget) * trait.openRatio);
  // 한도와 예산 잔여를 둘 다 지켜야 체결 — 총예산 초과 에스크로는 실지갑에서 불가능하다.
  const blockReason: BlockReason = floor > cap ? "cap" : floor > remainingBudget ? "budget" : null;
  const agreed = blockReason === null;
  const amount = agreed ? Math.min(cap, remainingBudget, Math.max(opening, floor)) : 0;
  return { cap, floor, opening, agreed, amount, blockReason };
}

export function taskBriefFor(brand: BrandProfile | null): TaskBrief {
  return {
    criteria: [
      "#광고 표기 필수 (게시물 상단)",
      "제품 실사용 컷 3초 이상",
      `@${brandHandle(brand)} 계정 태그`,
    ],
    tasks: [
      "릴스 1개 업로드 (30초 내외)",
      "업로드 후 게시물 URL 제출",
      "48시간 인사이트 공유 동의",
    ],
    references: [
      { title: `${productName(brand)} 첫인상 릴스`, length: "0:27", note: "전환 컷 리듬 참고" },
      { title: `${productName(brand, 1)} 실사용 브이로그`, length: "0:31", note: "실사용 연출 참고" },
      { title: "엔딩 CTA 훅 모음", length: "0:24", note: "마지막 3초 CTA 참고" },
    ],
  };
}

/* -------------------------------- 상태 헬퍼 -------------------------------- */

function feed(draft: DemoState, icon: string, text: string, tone: FeedTone = "info") {
  draft.feed.unshift({ id: nextId(), icon, text, tone, at: Date.now() });
  if (draft.feed.length > 40) draft.feed.pop();
}

function agentSays(draft: DemoState, text: string, chips?: ChatChip[]) {
  draft.agentTyping = false;
  draft.chat.push({ id: nextId(), role: "agent", text, chips, at: Date.now() });
}

function typing(draft: DemoState) {
  draft.agentTyping = true;
}

function a2a(
  draft: DemoState,
  creatorId: string,
  from: "brand" | "creator" | "policy",
  text: string,
  reasoning?: string,
  amountUsdc?: number | null,
) {
  const n = draft.campaign?.negotiations[creatorId];
  if (!n) return;
  n.status = "talking";
  n.messages.push({ id: nextId(), from, text, reasoning, amountUsdc });
}

function patchOffer(
  draft: DemoState,
  id: string,
  patch: Partial<Pick<InboundOffer, "status" | "amountUsdc" | "note">>,
) {
  const o = draft.inboundOffers.find((x) => x.id === id);
  if (o) Object.assign(o, patch);
}

const txHash = (label: string) => {
  let h = 0x811c9dc5;
  const s = `${label}:${seq}`;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${hex}…${hex.slice(0, 4)}`;
};

/* ------------------------------ 1. 온보딩 스캔 ------------------------------ */

export function scanSequence(url: string): SequenceStep[] {
  const steps: SequenceStep[] = [
    {
      d: 0,
      run: (draft) => {
        draft.stage = "scanning";
        draft.scan = { url, step: 0, done: false };
      },
    },
  ];
  for (let i = 1; i <= 4; i += 1) {
    steps.push({
      d: i === 1 ? 900 : 750,
      run: (draft) => {
        if (draft.scan) draft.scan.step = i;
      },
    });
  }
  // 피날레(브랜드 확정 + 부화)는 store.finishScan이 실제 스캔 결과 도착 시점에 처리한다.
  return steps;
}

export function enterWorkspaceSequence(): SequenceStep[] {
  return [
    {
      d: 0,
      run: (draft) => {
        draft.stage = "workspace";
        feed(draft, "🧶", `브랜드 에이전트 ${draft.brand?.agentName ?? "타래"} 생성 완료`, "ok");
      },
    },
    { d: 700, run: typing },
    {
      d: 1200,
      run: (draft) => {
        const b = draft.brand;
        const toneLine = b?.tone.length ? `${b.tone.slice(0, 3).join("·")} 톤, 마음에 들어요` : "브랜드 결이 마음에 들어요";
        const productLine = b?.products[0]?.name ? ` ${b.products[0].name}도 눈여겨봤고요.` : "";
        agentSays(
          draft,
          `안녕하세요, ${brandName(b)}의 에이전트 ${agentName(b)}예요. 사이트 다 읽었어요 — ${toneLine}.${productLine} 첫 캠페인 시작해볼까요?`,
          [{ id: "start-campaign", label: "새 캠페인 만들기" }],
        );
      },
    },
  ];
}

/* --------------------------- 2. 캠페인 생성 (칩 대화) --------------------------- */

export function composeFlowFor(
  brand: BrandProfile | null,
  spec: { budgetUsdc: number; maxPerDealUsdc: number } = DEFAULT_BUDGET,
) {
  const product = productName(brand);
  return {
    goal: {
      question: "좋아요. 이번 캠페인 목표가 뭐예요?",
      chips: [
        { id: "goal-launch", label: `${product} 런칭 붐업` },
        { id: "goal-aware", label: "브랜드 인지도" },
        { id: "goal-conv", label: "전환 · 판매" },
      ],
    },
    budget: {
      question: `${product} 캠페인이군요. 예산은 어떻게 잡을까요? 딜당 한도는 제가 넘을 수 없는 선이에요 — 그 안에선 승인 없이 제가 알아서 체결해요. 직접 숫자를 입력하셔도 돼요.`,
      chips: [
        { id: "budget-500", label: "총 500 · 딜당 300" },
        { id: "budget-1000", label: "총 1,000 · 딜당 450" },
        { id: "budget-2000", label: "총 2,000 · 딜당 600" },
      ],
    },
    content: {
      question: "콘텐츠 형식은요?",
      chips: [
        { id: "content-reel", label: "릴스 1개" },
        { id: "content-reel-story", label: "릴스 + 스토리" },
        { id: "content-shorts", label: "유튜브 쇼츠" },
      ],
    },
    confirm: {
      question: `정리하면 — ${product} 런칭 · 총 ${spec.budgetUsdc.toLocaleString()} USDC (딜당 ${spec.maxPerDealUsdc.toLocaleString()}) · 릴스 1개 · 2주 안에. 이 조건으로 크리에이터 탐험 다녀올게요. 물어오는 딜은 승인만 해주시면 돼요.`,
      chips: [{ id: "launch-expedition", label: "🧭 탐험 보내기" }],
    },
  } as const;
}

/* ------------------------------- 3. 탐험 대본 ------------------------------- */

export function expeditionSequence(
  brand: BrandProfile | null,
  budget: { budgetUsdc: number; maxPerDealUsdc: number } = DEFAULT_BUDGET,
): SequenceStep[] {
  const S: SequenceStep[] = [];
  const step = (d: number, run: SequenceStep["run"]) => S.push({ d, run });
  const bName = brandName(brand);
  const product = productName(brand);
  const cap = budget.maxPerDealUsdc;
  // 예산 배분은 적합도 순(ssin 우선) — "예산 여유분 우선 배정" 대사와 일치한다.
  const ssin = negotiate("ssin", cap, budget.budgetUsdc);
  const bonus = ssin.agreed
    ? Math.max(0, Math.min(Math.round(ssin.amount * 0.1), cap - ssin.amount, budget.budgetUsdc - ssin.amount))
    : 0;
  const afterSsin = budget.budgetUsdc - (ssin.agreed ? ssin.amount + bonus : 0);
  const geekble = negotiate("geekble", cap, afterSsin);
  const afterGeekble = afterSsin - (geekble.agreed ? geekble.amount : 0);
  const risabae = negotiate("risabae", cap, afterGeekble);

  // -- 출발 + 스카우팅 --
  step(0, (draft) => {
    draft.composeStep = "done";
    draft.campaign = {
      spec: { ...CAMPAIGN_SPEC, ...budget, goal: `${product} 런칭 붐업` },
      status: "scouting",
      discovered: [],
      negotiations: {},
      deals: [],
      brief: null,
      reportReady: false,
    };
    feed(draft, "🧭", "탐험 출발 — 크리에이터 네트워크 스캔 시작");
  });
  CREATORS.forEach((c, i) => {
    step(i === 0 ? 1400 : 1100, (draft) => {
      draft.campaign?.discovered.push(c.id);
      draft.campaign!.negotiations[c.id] = {
        creatorId: c.id,
        status: "queued",
        messages: [],
        agreedUsdc: null,
        blockedReason: null,
      };
      feed(draft, "✨", `${c.handle} 발견 — 적합도 ${c.fit}`, "info");
    });
  });
  step(1200, (draft) => {
    draft.campaign!.status = "negotiating";
    feed(draft, "🤝", "적합도 상위 3명과 A2A 협상 개시");
  });

  // -- 긱블: 스피드런 체결 (가격 맞으면 바로, 아니면 즉시 철수) --
  step(900, (draft) => {
    draft.campaign!.negotiations.geekble.status = "contacting";
  });
  step(900, (draft) =>
    a2a(
      draft,
      "geekble",
      "brand",
      `안녕하세요 긱블 에이전트님! ${bName} ${product} 런칭 릴스 1건, ${geekble.opening} USDC로 제안드려요.`,
      `긱블 평균 조회수 28.6만 — CPM 효율 최상 구간. 딜당 한도 ${cap}의 ${pct(NEGOTIATION_TRAITS.geekble.openRatio)}에서 시작.`,
      geekble.opening,
    ),
  );
  if (geekble.agreed) {
    step(1700, (draft) =>
      a2a(
        draft,
        "geekble",
        "creator",
        `${product}, 직접 만져보고 보여줄 수 있는 아이템이라 긱블 결이랑 맞네요. 기준선 ${geekble.floor} 넘었고 제작 슬롯도 비어 있어요 — 가격 맞으면 바로 갑니다. ${geekble.amount}으로 콜.`,
        `최소 단가 ${geekble.floor} 충족 + 카테고리 적합 → 즉시 수락.`,
        geekble.amount,
      ),
    );
    step(1400, (draft) => {
      a2a(draft, "geekble", "brand", "딜! 계약 아티팩트 만들게요 🧶", `${geekble.amount} ≤ 한도 ${cap} → 사람 승인 없이 자율 체결.`);
      draft.campaign!.negotiations.geekble.status = "agreed";
      draft.campaign!.negotiations.geekble.agreedUsdc = geekble.amount;
      feed(draft, "🪢", `@geekble_kr 체결 — ${geekble.amount} USDC (2라운드)`, "ok");
    });
  } else {
    const isBudget = geekble.blockReason === "budget";
    step(1700, (draft) =>
      a2a(
        draft,
        "geekble",
        "creator",
        `긱블 제작 최소 단가는 ${geekble.floor}이에요. 이 아래는 논의하지 않아요.`,
        `채널 정책: ${geekble.floor} 미만 제안 자동 거절.`,
        geekble.floor,
      ),
    );
    step(1300, (draft) =>
      a2a(
        draft,
        "geekble",
        "policy",
        isBudget
          ? `정책 차단 — 캠페인 예산 잔여가 ${geekble.floor} USDC에 못 미침`
          : `정책 차단 — 요구액 ${geekble.floor} USDC가 딜당 한도 ${cap}을 초과`,
        isBudget
          ? "총예산을 넘는 에스크로는 걸 수 없다 — 지갑에 있는 만큼만 쓴다."
          : "한도는 사람이 정한 숫자. 에이전트는 넘을 수 없고, 넘으려면 사람이 한도를 올려야 함.",
        geekble.floor,
      ),
    );
    step(1400, (draft) => {
      a2a(
        draft,
        "geekble",
        "brand",
        isBudget
          ? "이번 캠페인 예산이 다 차서 이번 건은 보류할게요. 다음 캠페인에서 꼭 다시 인사드릴게요."
          : `${geekble.floor}은 제 권한 밖이라 이번 건은 접을게요.`,
        isBudget ? "예산 잔여 부족 시 자율 보류 — 초과 집행 금지." : "한도 초과 시 승인 요청 대신 철수 — 예산 보호가 기본 동작.",
      );
      draft.campaign!.negotiations.geekble.status = "blocked";
      draft.campaign!.negotiations.geekble.blockedReason = isBudget
        ? `예산 잔여 부족 (필요 ${geekble.floor})`
        : `딜당 한도 ${cap} 초과 (요구 ${geekble.floor})`;
      feed(draft, "🛡️", isBudget ? "@geekble_kr 협상 보류 — 예산 잔여 부족" : "@geekble_kr 협상 종료 — 정책 한도 초과로 자율 철수", "warn");
    });
  }

  // -- 씬님(주인공): 밀당 끝에 체결, 아니면 정책 차단 --
  step(1100, (draft) => {
    draft.campaign!.negotiations.ssin.status = "contacting";
    draft.inboundOffers.unshift({
      id: "offer-moodbeam",
      brandName: draft.brand?.name ?? "무드빔",
      brandLogo: draft.brand?.logo ?? "/demo/moodbeam.svg",
      amountUsdc: ssin.opening,
      format: "릴스 1개 (30초 내외)",
      status: "new",
      note: "루프가 조건 확인 중",
      at: Date.now(),
    });
  });
  step(1000, (draft) => {
    a2a(
      draft,
      "ssin",
      "brand",
      `씬님 에이전트님 안녕하세요, ${bName}의 ${agentName(brand)}예요. ${product} 런칭 릴스, ${ssin.opening} USDC 어때요?`,
      `뷰티 무드 정합 최상(94) → 예산 여유분 우선 배정. 한도의 ${pct(NEGOTIATION_TRAITS.ssin.openRatio)}에서 시작.`,
      ssin.opening,
    );
    patchOffer(draft, "offer-moodbeam", { status: "negotiating", note: "루프가 협상 중" });
  });
  step(2000, (draft) =>
    a2a(
      draft,
      "ssin",
      "creator",
      `씬님은 구독 100만 뷰티 채널이에요. 평균 조회수 7만이지만 뷰티 시청층이라 저장·전환이 다르죠. 씬님이 정해둔 기준선은 ${ssin.floor}입니다 — 이 아래론 저도 못 내려가요.`,
      `사람이 정한 최소 단가 ${ssin.floor}. 에이전트 권한으로도 내릴 수 없는 선.`,
      ssin.floor,
    ),
  );
  if (ssin.agreed) {
    step(2100, (draft) =>
      a2a(
        draft,
        "ssin",
        "brand",
        `방금 전환 데이터 확인했어요 — 저장률이 카테고리 평균의 3배네요. ${ssin.amount}이면 제 권한(딜당 ${cap}) 안이라 승인 없이 체결 가능해요. 콜.`,
        `성과 데이터 검증 통과. ${ssin.amount} ≤ ${cap} → 자율 체결 가능.`,
        ssin.amount,
      ),
    );
    if (bonus > 0) {
      step(1900, (draft) =>
        a2a(
          draft,
          "ssin",
          "creator",
          `좋아요. 대신 성과 보너스 조항 하나만 — 조회수 15만(평균 7만의 2배) 넘으면 +${bonus} 어때요?`,
          "기준 규칙: 평균 조회수 2배(15만) 초과 시 +10% 보너스 요구.",
          ssin.amount + bonus,
        ),
      );
    }
    step(1800, (draft) => {
      a2a(
        draft,
        "ssin",
        "brand",
        bonus > 0
          ? "합리적이네요. 보너스는 에스크로에 조건부로 걸어둘게요. 계약 묶습니다 🪢"
          : "좋아요, 그 조건으로 계약 묶습니다 🪢",
        bonus > 0
          ? `체결가 ${ssin.amount} + 조건부 보너스 ${bonus} = 최대 ${ssin.amount + bonus} ≤ 한도 ${cap}.`
          : `체결가 ${ssin.amount} ≤ 한도 ${cap}.`,
        ssin.amount,
      );
      draft.campaign!.negotiations.ssin.status = "agreed";
      draft.campaign!.negotiations.ssin.agreedUsdc = ssin.amount;
      patchOffer(draft, "offer-moodbeam", {
        status: "agreed",
        amountUsdc: ssin.amount,
        note: bonus > 0 ? `${ssin.amount} + 보너스 조항 — 브랜드 승인 대기` : `${ssin.amount} — 브랜드 승인 대기`,
      });
      feed(
        draft,
        "🪢",
        bonus > 0
          ? `@ssin 체결 — ${ssin.amount} USDC + 보너스 조항 (4라운드)`
          : `@ssin 체결 — ${ssin.amount} USDC (3라운드)`,
        "ok",
      );
    });
  } else {
    step(1900, (draft) =>
      a2a(
        draft,
        "ssin",
        "policy",
        `정책 차단 — 요구액 ${ssin.floor} USDC가 딜당 한도 ${cap}을 초과`,
        "한도는 사람이 정한 숫자. 에이전트는 넘을 수 없고, 넘으려면 사람이 한도를 올려야 함.",
        ssin.floor,
      ),
    );
    step(1800, (draft) => {
      a2a(draft, "ssin", "brand", `${ssin.floor}은 제 권한 밖이라 이번 건은 접을게요. 다음 캠페인 예산에서 다시 인사드릴게요 🙇`, "한도 초과 시 승인 요청 대신 철수 — 예산 보호가 기본 동작.");
      draft.campaign!.negotiations.ssin.status = "blocked";
      draft.campaign!.negotiations.ssin.blockedReason = `딜당 한도 ${cap} 초과 (요구 ${ssin.floor})`;
      patchOffer(draft, "offer-moodbeam", { status: "declined", note: `한도 ${cap} 초과 — 자율 철수` });
      feed(draft, "🛡️", "@ssin 협상 종료 — 정책 한도 초과로 자율 철수", "warn");
    });
  }

  // -- 리사배: 프리미엄 하드 플로어 (한도가 넘으면만 체결) --
  step(1100, (draft) => {
    draft.campaign!.negotiations.risabae.status = "contacting";
  });
  step(1000, (draft) =>
    a2a(
      draft,
      "risabae",
      "brand",
      `RISABAE 팀 에이전트님, ${bName} ${product} 런칭 협업 제안드려요. ${risabae.opening} USDC부터 시작해볼까요?`,
      `구독 268만 메가 채널 → 프리미엄 단가 예상, 한도의 ${pct(NEGOTIATION_TRAITS.risabae.openRatio)}에서 높게 시작.`,
      risabae.opening,
    ),
  );
  step(1900, (draft) =>
    a2a(
      draft,
      "risabae",
      "creator",
      `리사배님 브랜드 협업 최소 단가는 ${risabae.floor}이에요. 268만 채널 기준이라 그 아래는 논의하지 않습니다.`,
      `채널 정책: ${risabae.floor} 미만 제안 자동 거절.`,
      risabae.floor,
    ),
  );
  if (risabae.agreed) {
    step(1600, (draft) => {
      a2a(draft, "risabae", "brand", `${risabae.amount}이면 제 권한(딜당 ${cap}) 안이에요. 바로 갑니다 🪢`, `${risabae.amount} ≤ 한도 ${cap} → 자율 체결 가능.`, risabae.amount);
      draft.campaign!.negotiations.risabae.status = "agreed";
      draft.campaign!.negotiations.risabae.agreedUsdc = risabae.amount;
      feed(draft, "🪢", `@RISABAE 체결 — ${risabae.amount} USDC (3라운드)`, "ok");
    });
  } else {
    const rIsBudget = risabae.blockReason === "budget";
    step(1600, (draft) =>
      a2a(
        draft,
        "risabae",
        "policy",
        rIsBudget
          ? `정책 차단 — 캠페인 예산 잔여가 ${risabae.floor} USDC에 못 미침`
          : `정책 차단 — 요구액 ${risabae.floor} USDC가 딜당 한도 ${cap}을 초과`,
        rIsBudget
          ? "총예산을 넘는 에스크로는 걸 수 없다 — 지갑에 있는 만큼만 쓴다."
          : "한도는 사람이 정한 숫자. 에이전트는 넘을 수 없고, 넘으려면 사람이 한도를 올려야 함.",
        risabae.floor,
      ),
    );
    step(1700, (draft) => {
      a2a(
        draft,
        "risabae",
        "brand",
        rIsBudget
          ? "이번 캠페인 예산이 다 차서 이번 건은 보류할게요. 다음 캠페인 예산에서 다시 인사드릴게요 🙇"
          : `${risabae.floor}은 제 권한 밖이라 이번 건은 접을게요. 다음 캠페인 예산에서 다시 인사드릴게요 🙇`,
        rIsBudget ? "예산 잔여 부족 시 자율 보류 — 초과 집행 금지." : "한도 초과 시 승인 요청 대신 철수 — 예산 보호가 기본 동작.",
      );
      draft.campaign!.negotiations.risabae.status = "blocked";
      draft.campaign!.negotiations.risabae.blockedReason = rIsBudget
        ? `예산 잔여 부족 (필요 ${risabae.floor})`
        : `딜당 한도 ${cap} 초과 (요구 ${risabae.floor})`;
      feed(draft, "🛡️", rIsBudget ? "@RISABAE 협상 보류 — 예산 잔여 부족" : "@RISABAE 협상 종료 — 정책 한도 초과로 자율 철수", "warn");
    });
  }

  // -- 귀환 보고 (실제 결과를 그대로 읽어서 만든다 — 대사가 결과와 어긋나면 버그) --
  step(1500, (draft) => {
    const negs = Object.values(draft.campaign!.negotiations);
    const agreedCount = negs.filter((n) => n.status === "agreed").length;
    draft.campaign!.status = "pending_approval";
    feed(draft, "🎒", `탐험 귀환 — 딜 ${agreedCount}건 확보, 승인 대기`, "money");
  });
  step(600, typing);
  step(1300, (draft) => {
    const negs = draft.campaign!.negotiations;
    const agreed = Object.values(negs).filter((n) => n.status === "agreed");
    const blocked = Object.values(negs).filter((n) => n.status === "blocked");
    const total = agreed.reduce((sum, n) => sum + (n.agreedUsdc ?? 0), 0);
    const budgetPct = Math.round((total / draft.campaign!.spec.budgetUsdc) * 100);
    const nameOf = (id: string) => creatorById(id).name;
    const agreedLine = agreed
      .map((n) => `${nameOf(n.creatorId)} ${n.agreedUsdc}${n.creatorId === "ssin" ? "(+보너스 조항)" : ""}`)
      .join(", ");
    const capBlocked = blocked.filter((n) => !n.blockedReason?.includes("예산"));
    const budgetBlocked = blocked.filter((n) => n.blockedReason?.includes("예산"));
    const blockedParts = [
      capBlocked.length ? `${capBlocked.map((n) => nameOf(n.creatorId)).join(", ")}는 한도를 넘겨서 접었고` : "",
      budgetBlocked.length ? `${budgetBlocked.map((n) => nameOf(n.creatorId)).join(", ")}는 예산이 다 차서 다음 캠페인으로 보류했어요` : "",
    ].filter(Boolean);
    const text =
      agreed.length === 0
        ? `탐험 다녀왔는데 이번엔 조건이 안 맞아서 체결된 딜이 없어요. 한도나 예산을 올려주시면 다시 시도해볼게요.`
        : `탐험 다녀왔어요! ${CREATORS.length}명 만나서 ${agreed.length}건 물어왔습니다 — ${agreedLine}. 합계 ${total} USDC로 예산의 ${budgetPct}%예요.${
            blockedParts.length ? ` ${blockedParts.join(", ")}.` : ""
          } 승인해주시면 에스크로 걸고 바로 시작합니다.`;
    agentSays(draft, text);
  });
  return S;
}

/* ---------------------------- 4. 승인 → 매듭 → 진행 ---------------------------- */

export function knotSequence(brand: BrandProfile | null): SequenceStep[] {
  const S: SequenceStep[] = [];
  const step = (d: number, run: SequenceStep["run"]) => S.push({ d, run });

  step(0, (draft) => {
    draft.campaign!.status = "knotting";
    feed(draft, "🪢", "승인 완료 — 에이전트 매듭 묶는 중", "ok");
  });
  step(2600, (draft) => {
    const c = draft.campaign!;
    c.status = "active";
    c.brief = taskBriefFor(brand);
    // 실제로 체결된(agreed) 딜만 — 몇 명이 됐는지는 딜당 한도에 달려 있다.
    c.deals = Object.values(c.negotiations)
      .filter((n) => n.status === "agreed" && n.agreedUsdc != null)
      .map((n) => {
        const amount = n.agreedUsdc!;
        const m1 = Math.round(amount * 0.3);
        return {
          creatorId: n.creatorId,
          amountUsdc: amount,
          termsHash: txHash(`terms-${n.creatorId}`),
          milestones: [
            { id: "m1", label: "계약 체결", pct: 30, usdc: m1, status: "active" as const },
            { id: "m2", label: "게시물 검증", pct: 70, usdc: amount - m1, status: "locked" as const },
          ],
          starPct: 10,
          bonusUsdc: null,
          postUrl: null,
          awaitingPost: false,
          verify: null,
          metrics: null,
          txs: [{ label: `에스크로 예치 ${amount} USDC`, hash: txHash(`lock-${n.creatorId}`) }],
        };
      });
    const totalLocked = c.deals.reduce((sum, d) => sum + d.amountUsdc, 0);
    feed(draft, "🔒", `에스크로 예치 ${totalLocked} USDC (devnet)`, "money");
    feed(draft, "📦", "A2A 태스크 브리프 전송 — 기준 3 · 태스크 3 · 레퍼런스 3", "info");
  });

  // 마일스톤 1 (계약 체결 30%) 즉시 릴리즈 — 딜이 몇 건이든 전부
  step(2200, (draft) => {
    let m1Sum = 0;
    for (const deal of draft.campaign!.deals) {
      deal.milestones[0].status = "released";
      deal.milestones[1].status = "active";
      deal.starPct = 30;
      deal.txs.push({
        label: `마일스톤 1 릴리즈 ${deal.milestones[0].usdc} USDC`,
        hash: txHash(`m1-${deal.creatorId}`),
      });
      m1Sum += deal.milestones[0].usdc;
    }
    const ssinDeal = draft.campaign!.deals.find((d) => d.creatorId === HERO_ID);
    if (ssinDeal) draft.creatorWalletUsdc += ssinDeal.milestones[0].usdc;
    feed(draft, "💸", `마일스톤 1 자동 릴리즈 — ${m1Sum} USDC 지급`, "money");
  });

  // 씬님(주인공): 촬영 시작 → 실제 게시물 URL 제출 대기 (크리에이터 창 게이트) — 딜이 있을 때만
  step(2600, (draft) => {
    const ssin = draft.campaign!.deals.find((d) => d.creatorId === HERO_ID);
    if (!ssin) return;
    ssin.starPct = 45;
    feed(draft, "🎬", "@ssin 촬영 시작 — 브리프 레퍼런스 2번 무드로 간대요", "info");
  });
  step(2600, (draft) => {
    const ssin = draft.campaign!.deals.find((d) => d.creatorId === HERO_ID);
    if (!ssin) return;
    ssin.starPct = 55;
    ssin.awaitingPost = true;
    feed(draft, "📤", "@ssin 업로드 대기 — 크리에이터가 게시물 URL을 제출하면 검증이 시작돼요", "info");
  });

  // 나머지 딜(긱블, 드물게 리사배)은 NPC로 자동 마무리 — 있을 때만
  const NPC_METRICS: Record<string, { views: string; saves: string; ctr: string; cpmDelta: string }> = {
    geekble: { views: "26.4만", saves: "2,300", ctr: "2.1%", cpmDelta: "-18%" },
    risabae: { views: "41.8만", saves: "6,150", ctr: "1.6%", cpmDelta: "-9%" },
  };
  const npcDelay: Record<string, number> = { geekble: 5200, risabae: 6400 };
  for (const npcId of ["geekble", "risabae"]) {
    step(npcDelay[npcId], (draft) => {
      const deal = draft.campaign!.deals.find((d) => d.creatorId === npcId);
      if (!deal) return;
      deal.milestones[1].status = "released";
      deal.starPct = 100;
      deal.postUrl = `youtube.com/watch?v=${npcId}-${brandHandle(brand)}`;
      deal.metrics = NPC_METRICS[npcId];
      deal.txs.push({ label: `마일스톤 2 릴리즈 ${deal.milestones[1].usdc} USDC`, hash: txHash(`m2-${npcId}`) });
      feed(draft, "🧶", `${creatorById(npcId).handle} 타래 완성 — ${deal.milestones[1].usdc} USDC 릴리즈`, "money");
    });
  }
  return S;
}

/* ------------------------- 4.5 게시물 제출 → 검증 → 정산 ------------------------- */

/** 증빙 판정 — 하드 게이트. 통과 못 하면 다음 스텝으로 못 넘어간다. */
export function verifyPostUrl(url: string, brand: BrandProfile | null): { label: string; ok: boolean }[] {
  const t = url.trim();
  const reachable = /^https?:\/\/\S+\.\S+/i.test(t) || /^\S+\.(com|kr|net|io)\/\S+/i.test(t);
  const isSocial = /instagram\.com|youtube\.com|youtu\.be|tiktok\.com/i.test(t);
  return [
    { label: "URL 접근 가능", ok: reachable },
    { label: "지원 플랫폼 (인스타 · 유튜브 · 틱톡)", ok: isSocial },
    { label: `#광고 표기 · @${brandHandle(brand)} 태그`, ok: reachable && isSocial },
  ];
}

export function postSubmittedSequence(url: string, brand: BrandProfile | null): SequenceStep[] {
  const S: SequenceStep[] = [];
  const step = (d: number, run: SequenceStep["run"]) => S.push({ d, run });
  const checks = verifyPostUrl(url, brand);
  const passed = checks.every((c) => c.ok);

  step(0, (draft) => {
    const ssin = draft.campaign?.deals.find((d) => d.creatorId === HERO_ID);
    if (!ssin || !ssin.awaitingPost) return;
    ssin.postUrl = url.trim();
    ssin.verify = null;
    ssin.awaitingPost = false;
    ssin.starPct = 70;
    feed(draft, "📤", "@ssin 게시물 제출 — 증빙 검증 시작", "info");
  });
  step(1600, (draft) => {
    const ssin = draft.campaign!.deals.find((d) => d.creatorId === HERO_ID);
    if (!ssin) return;
    ssin.verify = checks;
    if (!passed) {
      ssin.awaitingPost = true;
      ssin.starPct = 55;
      feed(draft, "🛑", "증빙 검증 실패 — URL을 확인하고 다시 제출해주세요", "warn");
    } else {
      ssin.milestones[1].status = "review";
      ssin.starPct = 85;
      feed(draft, "🔍", "증빙 검증 통과 — URL 접근 ✓ · 플랫폼 ✓ · 태그 ✓", "ok");
    }
  });
  if (!passed) return S;

  step(2200, (draft) => {
    const ssin = draft.campaign!.deals.find((d) => d.creatorId === HERO_ID);
    if (!ssin) return;
    ssin.milestones[1].status = "released";
    ssin.starPct = 100;
    ssin.txs.push({ label: `마일스톤 2 릴리즈 ${ssin.milestones[1].usdc} USDC`, hash: txHash("m2-ssin") });
    draft.creatorWalletUsdc += ssin.milestones[1].usdc;
    draft.burstSeq += 1;
    feed(draft, "🧶", `@ssin 타래 완성 — ${ssin.milestones[1].usdc} USDC 릴리즈`, "money");
  });
  step(2800, (draft) => {
    const ssin = draft.campaign!.deals.find((d) => d.creatorId === HERO_ID);
    if (!ssin) return;
    ssin.metrics = { views: "18.2만", saves: "1,540", ctr: "2.4%", cpmDelta: "-31%" };
    // 보너스는 체결가의 10%를 한도 잔여분으로 클램프 — 작은 실예산에서도 한도를 안 넘는다
    const cap = draft.campaign!.spec.maxPerDealUsdc;
    const bonus = Math.max(0, Math.min(Math.round(ssin.amountUsdc * 0.1), cap - ssin.amountUsdc));
    if (bonus > 0) {
      ssin.bonusUsdc = bonus;
      ssin.txs.push({ label: `성과 보너스 릴리즈 ${bonus} USDC`, hash: txHash("bonus-ssin") });
      draft.creatorWalletUsdc += bonus;
      draft.burstSeq += 1;
      feed(draft, "🎁", `조회수 18.2만 (조건 15만 초과) — 보너스 ${bonus} USDC 자동 지급`, "money");
    }
  });
  step(2400, (draft) => {
    draft.campaign!.status = "completed";
    draft.campaign!.reportReady = true;
    feed(draft, "📊", "캠페인 완료 — 에이전트가 리포트 들고 귀환", "ok");
  });
  step(600, typing);
  step(1400, (draft) => {
    const r = REPORT_SUMMARY;
    const spent = draft.campaign!.deals.reduce((sum, d) => sum + d.amountUsdc + (d.bonusUsdc ?? 0), 0);
    const budget = draft.campaign!.spec.budgetUsdc;
    const savedPct = Math.max(0, Math.round((1 - spent / budget) * 100));
    agentSays(
      draft,
      `리포트 가져왔어요. 조회수 합계 ${r.totalViews}(목표 ${r.targetViews}), 저장 ${r.totalSaves}, 평균 CPM은 업계 대비 ${r.cpmVsIndustry}예요. 집행은 ${spent}/${budget.toLocaleString()} USDC — 협상으로 예산 ${savedPct}%를 아꼈어요. 다음엔 오토파일럿을 켜보세요. 한도 안에서는 승인 클릭조차 제가 대신할게요.`,
      [{ id: "toggle-autopilot", label: "🚀 오토파일럿 켜기" }],
    );
  });
  return S;
}

/* ------------------------------ 5. 오토파일럿 런 ------------------------------ */

export function autopilotSequence(brand: BrandProfile | null): SequenceStep[] {
  const S: SequenceStep[] = [];
  const step = (d: number, run: SequenceStep["run"]) => S.push({ d, run });
  const push = (draft: DemoState, text: string, tone: FeedTone = "info") => {
    draft.autopilotRun?.items.push({ id: nextId(), text, tone });
  };

  step(0, (draft) => {
    draft.autopilot = true;
    draft.autopilotRun = {
      label: `캠페인 #2 — ${productName(brand, 1)} 상시 캠페인`,
      items: [],
      spentUsdc: 0,
      dealCount: 0,
      done: false,
    };
    feed(draft, "🚀", "오토파일럿 ON — 잔여 예산 300 USDC 위임", "ok");
  });
  step(1300, (draft) => push(draft, "캠페인 #2 자동 생성 — 목표·형식은 리포트 학습값 적용"));
  step(1500, (draft) => push(draft, "테크 · 라이프 크리에이터 5명 스캔 — CPM 효율 1위 @jocoding 선정"));
  step(1800, (draft) =>
    push(draft, `${AUTOPILOT_CREATOR.handle} 협상 3라운드 — ${AUTOPILOT_CREATOR.amountUsdc} USDC 체결 (한도 내 자동 승인)`, "ok"),
  );
  step(1400, (draft) => {
    push(draft, `에스크로 예치 ${AUTOPILOT_CREATOR.amountUsdc} USDC · 브리프 전송 완료`, "money");
    if (draft.autopilotRun) {
      draft.autopilotRun.spentUsdc = AUTOPILOT_CREATOR.amountUsdc;
      draft.autopilotRun.dealCount = 1;
    }
  });
  step(1600, (draft) => {
    push(draft, "사람 개입 0회 — 다음 리포트는 금요일에 도착합니다", "ok");
    if (draft.autopilotRun) draft.autopilotRun.done = true;
    feed(draft, "🌙", "오토파일럿 가동 중 — 이제 데이터만 보면 됩니다", "info");
  });
  return S;
}
