import { NextRequest } from "next/server";

const API_BASE_URL =
  process.env.KNOT_API_BASE_URL ??
  process.env.NEXT_PUBLIC_KNOT_API_BASE_URL ??
  "http://127.0.0.1:8080";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

// apiClient가 PATCH /onboarding, DELETE /brand/promotions/{id}를 쓴다 —
// 프록시에 메서드가 없으면 브라우저에서 405로 죽는다.
export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

async function proxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const url = new URL(request.url);
  const target = new URL(`/api/v1/${path.join("/")}${url.search}`, API_BASE_URL);
  const body = request.method === "GET" ? undefined : await request.text();
  try {
    const response = await fetch(target, {
      method: request.method,
      body,
      cache: "no-store",
      headers: forwardedHeaders(request),
    });
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (caught) {
    // Surface a readable error instead of an opaque empty 500 — most commonly
    // KNOT_API_BASE_URL isn't set/reachable from this deployment.
    return Response.json(
      {
        detail: {
          title: "Backend unreachable",
          code: "UPSTREAM_UNREACHABLE",
          detail: `Proxy to ${target.origin} failed: ${
            caught instanceof Error ? caught.message : String(caught)
          }`,
        },
      },
      { status: 502 },
    );
  }
}

function forwardedHeaders(request: NextRequest) {
  const headers = new Headers();
  const contentType = request.headers.get("Content-Type");
  const idempotencyKey = request.headers.get("Idempotency-Key");
  const authorization = request.headers.get("Authorization");
  if (contentType) headers.set("Content-Type", contentType);
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  if (authorization) headers.set("Authorization", authorization);
  return headers;
}
