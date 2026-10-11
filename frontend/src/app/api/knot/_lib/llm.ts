import Anthropic from "@anthropic-ai/sdk";

/**
 * LLM 프로바이더 체인 — Google 해커톤이므로 Gemini 우선, Anthropic 보조,
 * 둘 다 없으면 null(클라이언트 결정론 폴백).
 */

export type LlmTurn = { role: "user" | "assistant"; content: string };

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

/** Cloud Run 메타데이터 서버에서 서비스 계정 토큰 — Vertex 호출용 (키 불필요). */
async function metadataToken(): Promise<string | null> {
  try {
    const res = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(2500) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

function requestBody(input: { system: string; turns: LlmTurn[]; json?: boolean; maxTokens?: number }) {
  return {
    systemInstruction: { parts: [{ text: input.system }] },
    contents: input.turns.map((t) => ({
      role: t.role === "user" ? "user" : "model",
      parts: [{ text: t.content }],
    })),
    generationConfig: {
      maxOutputTokens: input.maxTokens ?? 1200,
      temperature: 0.7,
      ...(input.json ? { responseMimeType: "application/json" } : {}),
    },
  };
}

function extractText(data: unknown): string | null {
  const d = data as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = (d.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  return text || null;
}

/** Vertex AI Gemini — GOOGLE_CLOUD_PROJECT + 메타데이터 토큰이 있을 때 (Cloud Run 등 GCP 내부). */
async function vertexGenerate(input: {
  system: string;
  turns: LlmTurn[];
  json?: boolean;
  maxTokens?: number;
}): Promise<string | null> {
  const project = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT_ID;
  if (!project) return null;
  const token = await metadataToken();
  if (!token) return null;
  const location = process.env.VERTEX_AI_LOCATION ?? "us-central1";
  const res = await fetch(
    `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(40_000),
      body: JSON.stringify(requestBody(input)),
    },
  );
  if (!res.ok) throw new Error(`vertex ${res.status}`);
  return extractText(await res.json());
}

async function geminiGenerate(input: {
  system: string;
  turns: LlmTurn[];
  json?: boolean;
  maxTokens?: number;
}): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(40_000),
      body: JSON.stringify(requestBody(input)),
    },
  );
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  return extractText(await res.json());
}

async function anthropicGenerate(input: {
  system: string;
  turns: LlmTurn[];
  maxTokens?: number;
}): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: "claude-opus-5",
    max_tokens: input.maxTokens ?? 1200,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: input.system,
    messages: input.turns.map((t) => ({ role: t.role, content: t.content })),
  });
  if (response.stop_reason === "refusal") return null;
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** 체인 실행 — 성공한 첫 프로바이더의 텍스트를 반환, 전부 실패하면 null. */
export async function generate(input: {
  system: string;
  turns: LlmTurn[];
  json?: boolean;
  maxTokens?: number;
}): Promise<string | null> {
  try {
    const g = await geminiGenerate(input);
    if (g) return g;
  } catch {
    // Gemini API 키 실패 → Vertex 시도
  }
  try {
    const v = await vertexGenerate(input);
    if (v) return v;
  } catch {
    // Vertex 실패 → Anthropic 시도
  }
  try {
    return await anthropicGenerate(input);
  } catch {
    return null;
  }
}

export function llmConfigured() {
  return Boolean(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCP_PROJECT_ID ||
      process.env.ANTHROPIC_API_KEY,
  );
}
