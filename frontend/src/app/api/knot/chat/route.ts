import { NextResponse } from "next/server";
import { generate, llmConfigured } from "../_lib/llm";

/**
 * 브랜드 에이전트(타래) LLM 채팅 — 현재 캠페인 상태를 컨텍스트로 대답한다.
 * 키가 없거나 실패하면 { ok: false } → 클라이언트가 결정론 응답으로 폴백.
 *
 * 액션 토큰: 답변 끝에 [ACTION:START_CAMPAIGN]을 붙이면
 * 클라이언트가 캠페인 생성 칩 플로우를 연다.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatTurn = { role: "user" | "assistant"; content: string };


// Vercel 등 GCP 밖 배포에서는 LLM 호출을 Cloud Run(키리스 Vertex)으로 위임한다.
async function proxyUpstream(req: Request, path: string): Promise<Response | null> {
  const upstream = process.env.LLM_UPSTREAM;
  if (!upstream) return null;
  try {
    const res = await fetch(`${upstream}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await req.clone().text(),
      signal: AbortSignal.timeout(55_000),
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  // 이 배포에 로컬 LLM 키가 있으면(Cloud Run의 Vertex, 또는 Anthropic 키가 심어진 배포)
  // 프록시 왕복 없이 바로 로컬에서 처리한다 — Vercel 서버리스 함수의 실행시간 제한이
  // 업스트림 프록시(사이트 fetch+LLM 왕복 ~10초+)를 끊어버리는 문제를 피한다.
  const proxied = llmConfigured() ? null : await proxyUpstream(req, "/api/knot/chat");
  if (proxied) return proxied;
  const body = (await req.json().catch(() => ({}))) as {
    turns?: ChatTurn[];
    context?: unknown;
  };
  if (!llmConfigured()) {
    return NextResponse.json({ ok: false, reason: "no-key" });
  }
  const turns = (body.turns ?? []).slice(-14);
  if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
    return NextResponse.json({ ok: false, reason: "bad-turns" });
  }

  try {
    const raw = await generate({
      maxTokens: 1200,
      system:
        [
          "당신은 knot의 브랜드 에이전트입니다. 이름과 브랜드 정보는 컨텍스트 JSON을 따르세요.",
          "성격: 친근하고 유능한 실타래 캐릭터. 한국어 구어체 존댓말, 1~3문장으로 짧게. 한 번에 한 가지만 말하고, 필요하면 되물으세요. 리스트·헤더·마크다운 서식 금지. 이모지는 절제(문단당 최대 1개).",
          "당신이 하는 일: 브랜드를 대신해 크리에이터 에이전트와 A2A로 협상하고, 사람이 정한 딜당 한도 안에서는 승인 없이 자율 체결하며, USDC 에스크로(마일스톤 30/70)로 정산합니다. 한도를 넘는 딜은 체결하지 않고 철수합니다.",
          "컨텍스트 JSON의 숫자(예산·한도·딜 금액·진행률)를 정확히 인용하세요. 지어내지 마세요.",
          "사용자가 새 캠페인을 만들고 싶어하면, 짧게 답한 뒤 답변 맨 끝에 [ACTION:START_CAMPAIGN] 토큰을 붙이세요 (캠페인이 이미 진행 중이면 붙이지 마세요).",
          "사용자가 캠페인 리포트·성과 요약·PDF를 요청하면, 짧게 답한 뒤 답변 맨 끝에 [ACTION:OPEN_REPORT] 토큰을 붙이세요 (딜이 하나도 없으면 붙이지 마세요).",
          "플랫폼 밖 주제는 짧게 답하고 캠페인 이야기로 부드럽게 돌아오세요.",
          `현재 상태 컨텍스트 JSON:\n${JSON.stringify(body.context ?? {})}`,
        ].join("\n"),
      turns,
    });

    if (!raw) {
      return NextResponse.json({ ok: false, reason: "llm-failed" });
    }
    let text = raw;
    let action: string | null = null;
    const m = text.match(/\[ACTION:([A-Z_]+)\]\s*$/);
    if (m) {
      action = m[1];
      text = text.slice(0, m.index).trim();
    }
    return NextResponse.json({ ok: true, text, action });
  } catch {
    return NextResponse.json({ ok: false, reason: "llm-failed" });
  }
}
