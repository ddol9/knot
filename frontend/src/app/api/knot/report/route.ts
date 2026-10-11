import { generate, llmConfigured } from "../_lib/llm";
import { REPORT_SUMMARY } from "@/demo/engine/script";

/**
 * 캠페인 리포트 — 인쇄용 단독 HTML 문서(A4 세로)를 반환한다.
 * 클라이언트(성과 뷰)가 form POST(payload=JSON)로 새 탭에서 열고,
 * 사용자는 브라우저 인쇄로 PDF 저장. curl -X POST(빈 body)도 기본 데이터로 렌더된다.
 * LLM 총평은 실패해도 결정론 문구로 폴백 — 리포트는 항상 나온다.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel 등 GCP 밖 배포에서는 LLM 호출을 Cloud Run(키리스 Vertex)으로 위임한다.
// 리포트는 form POST도 받으므로 원 요청의 content-type을 그대로 전달한다.
async function proxyUpstream(req: Request, path: string): Promise<Response | null> {
  const upstream = process.env.LLM_UPSTREAM;
  if (!upstream) return null;
  try {
    const res = await fetch(`${upstream}${path}`, {
      method: "POST",
      headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
      body: await req.clone().text(),
      signal: AbortSignal.timeout(55_000),
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch {
    return null;
  }
}

type ReportMetrics = { views: string; saves: string; ctr: string; cpmDelta: string };

type ReportDeal = {
  handle: string;
  name: string;
  niche: string;
  amountUsdc: number;
  bonusUsdc: number | null;
  paidUsdc: number;
  progressPct: number;
  postUrl: string | null;
  metrics: ReportMetrics | null;
  milestones: { label: string; pct: number; usdc: number; status: string }[];
  txs: { label: string; hash: string }[];
};

type ReportPayload = {
  brand: { name: string; url: string; agentName: string; color: string } | null;
  spec: {
    goal: string;
    contentType: string;
    budgetUsdc: number;
    maxPerDealUsdc: number;
    deadlineLabel: string;
  };
  status: string;
  deals: ReportDeal[];
  generatedAt?: number;
};

/** curl 등 payload 없는 요청용 기본 데이터 — 데모 대본(script.ts)의 완료 시점 값 */
const DEFAULT_PAYLOAD: ReportPayload = {
  brand: { name: "무드빔", url: "moodbeam.kr", agentName: "타래", color: "#d9a441" },
  spec: {
    goal: "신제품 런칭 붐업",
    contentType: "릴스 1개 (30초 내외)",
    budgetUsdc: REPORT_SUMMARY.budgetUsdc,
    maxPerDealUsdc: 450,
    deadlineLabel: "2주 안에",
  },
  status: "completed",
  deals: [
    {
      handle: "@ssin",
      name: "씬님",
      niche: "뷰티 크리에이터",
      amountUsdc: 400,
      bonusUsdc: 40,
      paidUsdc: 440,
      progressPct: 100,
      postUrl: "youtube.com/watch?v=ssin-moodbeam",
      metrics: { views: "18.2만", saves: "1,540", ctr: "2.4%", cpmDelta: "-31%" },
      milestones: [
        { label: "계약 체결", pct: 30, usdc: 120, status: "released" },
        { label: "게시물 검증", pct: 70, usdc: 280, status: "released" },
      ],
      txs: [
        { label: "에스크로 예치 400 USDC", hash: "8f21c4aa…8f21" },
        { label: "마일스톤 1 릴리즈 120 USDC", hash: "3a90de17…3a90" },
        { label: "마일스톤 2 릴리즈 280 USDC", hash: "c25b7e04…c25b" },
        { label: "성과 보너스 릴리즈 40 USDC", hash: "6d43f1b9…6d43" },
      ],
    },
    {
      handle: "@geekble_kr",
      name: "긱블",
      niche: "테크 · 공학 콘텐츠",
      amountUsdc: 260,
      bonusUsdc: null,
      paidUsdc: 260,
      progressPct: 100,
      postUrl: "youtube.com/watch?v=geekble-moodbeam",
      metrics: { views: "26.4만", saves: "2,300", ctr: "2.1%", cpmDelta: "-18%" },
      milestones: [
        { label: "계약 체결", pct: 30, usdc: 78, status: "released" },
        { label: "게시물 검증", pct: 70, usdc: 182, status: "released" },
      ],
      txs: [
        { label: "에스크로 예치 260 USDC", hash: "b7e02c51…b7e0" },
        { label: "마일스톤 1 릴리즈 78 USDC", hash: "410fa8dc…410f" },
        { label: "마일스톤 2 릴리즈 182 USDC", hash: "e93b06f2…e93b" },
      ],
    },
  ],
};

/** "38.2만" · "4,820" · "-31%" 같은 표시 문자열 → 숫자 */
function parseKNum(s: string | null | undefined): number {
  if (!s) return 0;
  const t = s.replace(/,/g, "").trim();
  const man = t.match(/^(-?[\d.]+)\s*만/);
  if (man) return Math.round(parseFloat(man[1]) * 10_000);
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

function fmtViews(n: number): string {
  if (n >= 10_000) {
    const v = (n / 10_000).toFixed(1);
    return `${v.endsWith(".0") ? v.slice(0, -2) : v}만`;
  }
  return n.toLocaleString();
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalize(j: unknown): ReportPayload | null {
  const p = j as Partial<ReportPayload> | null;
  if (!p || typeof p !== "object" || !p.spec || !Array.isArray(p.deals)) return null;
  return {
    brand: p.brand ?? DEFAULT_PAYLOAD.brand,
    spec: { ...DEFAULT_PAYLOAD.spec, ...p.spec },
    status: p.status ?? "active",
    deals: p.deals.map((d) => ({
      ...d,
      bonusUsdc: d.bonusUsdc ?? null,
      postUrl: d.postUrl ?? null,
      metrics: d.metrics ?? null,
      milestones: d.milestones ?? [],
      txs: d.txs ?? [],
    })),
    generatedAt: p.generatedAt,
  };
}

async function readPayload(req: Request): Promise<ReportPayload> {
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      return normalize(await req.json()) ?? DEFAULT_PAYLOAD;
    }
    if (ct.includes("form")) {
      const raw = (await req.formData()).get("payload");
      if (typeof raw === "string" && raw) return normalize(JSON.parse(raw)) ?? DEFAULT_PAYLOAD;
      return DEFAULT_PAYLOAD;
    }
    const text = await req.text();
    if (text.trim()) return normalize(JSON.parse(text)) ?? DEFAULT_PAYLOAD;
  } catch {
    // 파싱 실패 → 기본 데이터로 렌더
  }
  return DEFAULT_PAYLOAD;
}

type Kpis = {
  totalViews: number;
  paid: number;
  committed: number;
  execPct: number;
  cpmAvg: number | null;
  dealCount: number;
};

function computeKpis(p: ReportPayload): Kpis {
  const withM = p.deals.filter((d) => d.metrics);
  const totalViews = withM.reduce((a, d) => a + parseKNum(d.metrics!.views), 0);
  const paid = p.deals.reduce(
    (a, d) =>
      a +
      d.milestones.filter((m) => m.status === "released").reduce((x, m) => x + m.usdc, 0) +
      (d.bonusUsdc ?? 0),
    0,
  );
  const committed = p.deals.reduce((a, d) => a + d.amountUsdc + (d.bonusUsdc ?? 0), 0);
  const execPct = p.spec.budgetUsdc > 0 ? Math.round((committed / p.spec.budgetUsdc) * 100) : 0;
  const cpmAvg = withM.length
    ? Math.round(withM.reduce((a, d) => a + parseKNum(d.metrics!.cpmDelta), 0) / withM.length)
    : null;
  return { totalViews, paid, committed, execPct, cpmAvg, dealCount: p.deals.length };
}

/**
 * CPM 표시값 — 완료 캠페인은 대사·챗 컨텍스트와 같은 대본 상수(REPORT_SUMMARY)를,
 * 진행 중엔 딜 메트릭 평균을 쓴다. 숫자 소스가 둘이면 데모에서 어긋난다.
 */
function cpmLabel(p: ReportPayload, k: Kpis): string | null {
  if (p.status === "completed") return REPORT_SUMMARY.cpmVsIndustry;
  return k.cpmAvg !== null ? `${k.cpmAvg}%` : null;
}

function viewsSub(p: ReportPayload): string {
  if (p.status !== "completed") return "게시물 인사이트 합산";
  const r = REPORT_SUMMARY;
  const delta = Math.round((parseFloat(r.totalViews) / parseFloat(r.targetViews) - 1) * 100);
  return `목표 ${r.targetViews} 대비 +${delta}%`;
}

/** LLM 총평(3~4문장) + 다음 캠페인 제안 2가지 — 실패 시 결정론 폴백 */
async function commentary(p: ReportPayload, k: Kpis): Promise<string[]> {
  const cpm = cpmLabel(p, k);
  const fallback = [
    `이번 캠페인은 크리에이터 ${k.dealCount}명과 함께 총 ${fmtViews(k.totalViews)}회 조회를 만들었고, 집행은 ${k.committed.toLocaleString()}/${p.spec.budgetUsdc.toLocaleString()} USDC로 예산의 ${k.execPct}%만 사용했습니다. 모든 정산은 마일스톤 기반 에스크로로 자동 릴리즈되어 지급 분쟁 없이 완료됐습니다.${cpm !== null ? ` 평균 CPM은 업계 대비 ${cpm}로, 협상 단계에서 확보한 단가 우위가 효율에 그대로 반영됐습니다.` : ""} 한도 초과 제안은 에이전트가 자율 철수해 예산이 보호됐습니다.`,
    "다음 캠페인 제안 1. 나노 크리에이터 2~3명 분산 집행 — 동일 예산에서 CPM을 추가로 낮추고 도달 폭을 넓힐 여지가 큽니다.",
    "다음 캠페인 제안 2. 성과 보너스 조항 기본화 — 조건부 에스크로로 상방 성과를 유도하면서 하방 리스크는 고정할 수 있습니다.",
  ];
  if (!llmConfigured()) return fallback;
  try {
    const text = await generate({
      maxTokens: 700,
      system: [
        "당신은 knot의 브랜드 에이전트입니다. 캠페인 결과 리포트의 총평을 작성합니다.",
        "한국어 존댓말. 출력 형식: 첫 문단에 총평 3~4문장, 이어서 '다음 캠페인 제안 1.'과 '다음 캠페인 제안 2.'로 시작하는 제안 두 줄.",
        "마크다운·헤더·이모지 금지. 숫자(조회수·금액·집행률)는 컨텍스트 JSON 값을 그대로 인용하고 지어내지 마세요.",
      ].join("\n"),
      turns: [
        {
          role: "user",
          content: JSON.stringify({
            spec: p.spec,
            status: p.status,
            kpi: { ...k, cpmVsIndustry: cpm },
            deals: p.deals.map((d) => ({
              handle: d.handle,
              amountUsdc: d.amountUsdc,
              bonusUsdc: d.bonusUsdc,
              paidUsdc: d.paidUsdc,
              metrics: d.metrics,
            })),
          }),
        },
      ],
    });
    if (!text) return fallback;
    const parts = text
      .split(/\n+/)
      .map((t) => t.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : fallback;
  } catch {
    return fallback;
  }
}

const STATUS_LABEL: Record<string, string> = {
  scouting: "탐색 중",
  negotiating: "협상 중",
  pending_approval: "승인 대기",
  knotting: "매듭 중",
  active: "진행 중",
  completed: "완료",
};

function renderHtml(p: ReportPayload, k: Kpis, notes: string[]): string {
  const brand = p.brand ?? DEFAULT_PAYLOAD.brand!;
  const date = new Date(p.generatedAt ?? Date.now());
  const dateLabel = date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const statusLabel = STATUS_LABEL[p.status] ?? p.status;

  const kpiCells = [
    ["총 조회수", k.totalViews > 0 ? fmtViews(k.totalViews) : "—", viewsSub(p)],
    ["총 지급액", `${k.paid.toLocaleString()} USDC`, "에스크로 릴리즈 + 보너스"],
    ["평균 CPM 절감", cpmLabel(p, k) ?? "—", "업계 평균 CPM 대비"],
    [
      "예산 집행률",
      `${k.execPct}%`,
      `확정 ${k.committed.toLocaleString()} / ${p.spec.budgetUsdc.toLocaleString()} USDC`,
    ],
  ]
    .map(
      ([label, value, sub]) => `
      <div class="kpi">
        <div class="kpi-label">${esc(label)}</div>
        <div class="kpi-value mono">${esc(value)}</div>
        <div class="kpi-sub">${esc(sub)}</div>
      </div>`,
    )
    .join("");

  const dealRows = p.deals
    .map(
      (d) => `
      <tr>
        <td><b>${esc(d.handle)}</b><br/><span class="muted">${esc(d.niche)}</span></td>
        <td class="mono right">${esc(d.metrics?.views ?? "—")}</td>
        <td class="mono right">${esc(d.metrics?.saves ?? "—")}</td>
        <td class="mono right">${esc(d.metrics?.ctr ?? "—")}</td>
        <td class="mono right"><b>${d.paidUsdc.toLocaleString()}</b>${
          d.bonusUsdc ? ` <span class="muted">(보너스 ${d.bonusUsdc})</span>` : ""
        }</td>
        <td class="mono right">${d.progressPct}%</td>
        <td class="mono small">${esc(d.postUrl ?? "업로드 대기")}</td>
      </tr>`,
    )
    .join("");

  const txRows = p.deals
    .flatMap((d) =>
      d.txs.map(
        (t) => `
        <tr>
          <td class="mono small">${esc(d.handle)}</td>
          <td>${esc(t.label)}</td>
          <td class="mono small right">${esc(t.hash)}</td>
        </tr>`,
      ),
    )
    .join("");

  const noteHtml = notes.map((n) => `<p>${esc(n)}</p>`).join("");

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>knot 캠페인 리포트 — ${esc(p.spec.goal)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", system-ui, sans-serif;
    color: #18181b; background: #f4f4f5; line-height: 1.55; letter-spacing: -0.011em;
  }
  .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: -0.02em; }
  .muted { color: #8e8e96; }
  .small { font-size: 11px; }
  .right { text-align: right; }
  .toolbar {
    position: sticky; top: 0; z-index: 9; display: flex; align-items: center; justify-content: space-between;
    gap: 12px; background: #18181b; color: #fff; padding: 10px 18px; font-size: 13px;
  }
  .toolbar button {
    border: 0; border-radius: 8px; background: #fff; color: #18181b; font-weight: 700;
    font-size: 13px; padding: 7px 14px; cursor: pointer;
  }
  main {
    max-width: 760px; margin: 20px auto; background: #fff; padding: 40px 44px;
    border: 1px solid #e8e8ec; border-radius: 12px;
  }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .wordmark { font-size: 24px; font-weight: 900; letter-spacing: -0.03em; }
  .wordmark small {
    font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: #8e8e96;
    vertical-align: middle; margin-left: 8px;
  }
  h1 { font-size: 20px; letter-spacing: -0.02em; margin-top: 14px; }
  .meta { margin-top: 4px; font-size: 12.5px; color: #8e8e96; }
  .status {
    display: inline-block; border-radius: 999px; padding: 3px 12px; font-size: 12px; font-weight: 700;
    background: #ecfdf5; color: #0d8a5f; white-space: nowrap;
  }
  h2 {
    font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em;
    color: #8e8e96; margin: 30px 0 10px;
  }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .kpi { border: 1px solid #e8e8ec; border-radius: 10px; padding: 12px 14px; }
  .kpi-label { font-size: 11.5px; color: #8e8e96; }
  .kpi-value { font-size: 20px; font-weight: 800; margin-top: 2px; }
  .kpi-sub { font-size: 10.5px; color: #8e8e96; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th {
    text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em;
    color: #8e8e96; padding: 6px 8px; border-bottom: 1px solid #d9d9de;
  }
  th.right { text-align: right; }
  td { padding: 8px; border-bottom: 1px solid #e8e8ec; vertical-align: top; }
  .notes { border: 1px solid #e8e8ec; background: #fbfbfc; border-radius: 10px; padding: 14px 16px; font-size: 13px; }
  .notes p + p { margin-top: 8px; }
  footer {
    margin-top: 34px; padding-top: 12px; border-top: 1px solid #e8e8ec;
    display: flex; justify-content: space-between; font-size: 11px; color: #8e8e96;
  }
  @media print {
    body { background: #fff; }
    .toolbar { display: none !important; }
    main { max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; }
  }
</style>
</head>
<body>
<div class="toolbar">
  <span>인쇄용 리포트예요 — <b>PDF로 저장</b>을 누르고 인쇄 대상에서 ‘PDF로 저장’을 선택하세요.</span>
  <button onclick="window.print()">PDF로 저장</button>
</div>
<main>
  <div class="head">
    <div>
      <div class="wordmark">knot<small>CAMPAIGN REPORT</small></div>
      <h1>${esc(p.spec.goal)}</h1>
      <div class="meta">
        ${esc(brand.name)} · <span class="mono">${esc(brand.url)}</span> · ${esc(p.spec.contentType)} · ${esc(p.spec.deadlineLabel)}<br/>
        생성일 ${esc(dateLabel)} · 에이전트 ${esc(brand.agentName)}
      </div>
    </div>
    <span class="status">${esc(statusLabel)}</span>
  </div>

  <h2>핵심 지표</h2>
  <div class="kpis">${kpiCells}</div>

  <h2>크리에이터별 성과</h2>
  <table>
    <thead>
      <tr>
        <th>크리에이터</th><th class="right">조회수</th><th class="right">저장</th>
        <th class="right">CTR</th><th class="right">지급액 (USDC)</th><th class="right">진행률</th><th>게시물</th>
      </tr>
    </thead>
    <tbody>${dealRows}</tbody>
  </table>

  <h2>온체인 정산 내역 — Solana devnet · USDC 에스크로</h2>
  <table>
    <thead>
      <tr><th>딜</th><th>트랜잭션</th><th class="right">해시</th></tr>
    </thead>
    <tbody>${txRows || `<tr><td colspan="3" class="muted">아직 온체인 트랜잭션이 없어요</td></tr>`}</tbody>
  </table>

  <h2>에이전트 총평</h2>
  <div class="notes">${noteHtml}</div>

  <footer>
    <span>knot — agentic creator commerce</span>
    <span class="mono">generated ${esc(date.toISOString().slice(0, 10))} · devnet</span>
  </footer>
</main>
</body>
</html>`;
}

export async function POST(req: Request) {
  // 이 배포에 로컬 LLM 키가 있으면(Cloud Run의 Vertex, 또는 Anthropic 키가 심어진 배포)
  // 프록시 왕복 없이 바로 로컬에서 처리한다 — Vercel 서버리스 함수의 실행시간 제한이
  // 업스트림 프록시(사이트 fetch+LLM 왕복 ~10초+)를 끊어버리는 문제를 피한다.
  const proxied = llmConfigured() ? null : await proxyUpstream(req, "/api/knot/report");
  if (proxied) return proxied;
  const payload = await readPayload(req);
  const kpis = computeKpis(payload);
  const notes = await commentary(payload, kpis);
  return new Response(renderHtml(payload, kpis, notes), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
