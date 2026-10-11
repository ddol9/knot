import { NextResponse } from "next/server";

/**
 * A2A 에이전트 카드 프록시 — Cloud Run의 creator_agent가 서빙하는
 * /.well-known/agent-card.json을 가져와 { live: true }로 반환한다.
 * env(A2A_AGENT_BASE)가 없거나 fetch가 실패하면 백엔드의
 * build_creator_agent_card와 동일한 구조의 정적 카드로 폴백한다 (live: false).
 */

export const runtime = "nodejs";
export const maxDuration = 15;

function staticCard(baseUrl: string) {
  return {
    name: "KNOT Creator Negotiation Agent",
    description: "Evaluates and negotiates creator promotion offers.",
    supportedInterfaces: [
      {
        url: baseUrl,
        protocolBinding: "HTTP+JSON",
        protocolVersion: "1.0",
      },
    ],
    provider: { organization: "KNOT", url: "https://knot.example" },
    version: "1.0.0",
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "promotion-negotiation",
        name: "Promotion Negotiation",
        description: "Returns counter, accept, reject or escalation decisions.",
        tags: ["creator", "promotion", "negotiation"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],
  };
}

export async function GET() {
  const base = process.env.A2A_AGENT_BASE?.replace(/\/+$/, "");
  if (base) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(`${base}/a2a/v1/.well-known/agent-card.json`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (res.ok) {
          const card = await res.json();
          return NextResponse.json({ live: true, card });
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // 폴백으로 진행
    }
  }
  const fallbackBase = base ? `${base}/a2a/v1` : "http://localhost:8081/a2a/v1";
  return NextResponse.json({ live: false, card: staticCard(fallbackBase) });
}
