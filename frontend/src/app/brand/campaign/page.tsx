"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/auth/AuthGate";
import { type ApiPromotion, ProductApiClient, ProductApiError } from "@/product/apiClient";
import {
  CampaignForm,
  type CampaignFormValues,
  defaultCampaignFormValues,
  toCampaignRequest,
  validateCampaignForm,
} from "./components/CampaignForm";
import { CampaignResultBanner } from "./components/CampaignResultBanner";
import { DiscoveryTable, Pill } from "./components/DiscoveryTable";
import { LedgerTiles } from "./components/LedgerTiles";
import { NegotiationColumn } from "./components/NegotiationColumn";
import { useCampaignStream } from "./useCampaignStream";

/**
 * /brand/campaign?promotionId=… — 브랜드 매니저가 여러 크리에이터 매니저와 동시에
 * 협상하는 캠페인을 실행하고 SSE로 관전한다.
 */
export default function Page() {
  return (
    <AuthGate expectedRole="BRAND" requireCompleted>
      {() => (
        <Suspense fallback={<PanelMessage title="캠페인 준비 중" body="프로모션 정보를 확인하고 있습니다." />}>
          <BrandCampaignPage />
        </Suspense>
      )}
    </AuthGate>
  );
}

function BrandCampaignPage() {
  const searchParams = useSearchParams();
  const promotionId = searchParams.get("promotionId")?.trim() ?? "";
  if (!promotionId) {
    return (
      <PanelMessage
        title="프로모션을 선택해 주세요"
        body="캠페인은 프로모션 단위로 실행됩니다. 프로모션 상세의 ‘여러 크리에이터와 동시 협상’에서 들어와 주세요."
        action={{ href: "/brand", label: "대시보드로" }}
      />
    );
  }
  return <CampaignRunner promotionId={promotionId} />;
}

function CampaignRunner({ promotionId }: { promotionId: string }) {
  const client = useMemo(() => new ProductApiClient(), []);
  const [promotion, setPromotion] = useState<(ApiPromotion & Record<string, unknown>) | null>(null);
  const [promotionError, setPromotionError] = useState<string | null>(null);
  const [values, setValues] = useState<CampaignFormValues>(defaultCampaignFormValues);
  const [formError, setFormError] = useState<string | null>(null);
  const { state, start, cancel, reset } = useCampaignStream();

  useEffect(() => {
    let active = true;
    client
      .getBrandPromotionDetail(promotionId)
      .then((detail) => {
        if (!active) return;
        const loaded = detail.promotion;
        setPromotion(loaded);
        const initialOffer = typeof loaded.initialOffer === "number" ? loaded.initialOffer : null;
        setValues((current) => ({
          ...current,
          openingAmountUsdc: initialOffer != null ? String(initialOffer) : current.openingAmountUsdc,
          ceilingUsdc: String(loaded.budget.maxPerCreatorUsdc),
          maxRounds:
            loaded.autonomy?.maxNegotiationRounds != null
              ? String(loaded.autonomy.maxNegotiationRounds)
              : current.maxRounds,
        }));
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setPromotionError(readableError(caught));
      });
    return () => {
      active = false;
    };
  }, [client, promotionId]);

  const busy = state.phase === "connecting" || state.phase === "running";

  function submit() {
    const problem = validateCampaignForm(values);
    setFormError(problem);
    if (problem) return;
    start(client.campaignStreamUrl(promotionId, toCampaignRequest(values)));
  }

  const columns = state.columnOrder.map((id) => state.columns[id]).filter(Boolean);

  return (
    <div className="flex w-full min-w-0 flex-col gap-6 py-8">
      <section className="grid items-start gap-5 md:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <Link href={`/brand/promotions/${promotionId}`} className="font-mono text-xs uppercase text-muted">
            promotion
          </Link>
          <h1 className="mt-2 text-5xl">여러 크리에이터와 동시 협상</h1>
          <p className="mt-2 max-w-3xl text-muted">
            브랜드 매니저가 공개 프로필에서 후보를 고르고, 각 크리에이터 매니저와 A2A로 동시에 협상합니다. 합의되면
            합의서를 만들고 한도 안에서 에스크로에 예치합니다.
          </p>
          <p className="mt-2 break-all font-mono text-xs text-muted">
            {promotion ? `${promotion.title} · ` : ""}
            {promotionId}
            {promotion ? ` · 총 예산 ${promotion.budget.totalUsdc.toLocaleString()} USDC · 딜당 한도 ${promotion.budget.maxPerCreatorUsdc.toLocaleString()} USDC` : ""}
          </p>
          {promotionError ? (
            <p className="mt-2 text-sm text-negative">프로모션 정보를 불러오지 못했습니다: {promotionError}</p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2 text-right">
          <PhasePill phase={state.phase} />
          {state.campaignId ? (
            <span className="break-all font-mono text-[10px] text-muted">
              campaign {state.campaignId}
              {state.a2aMode ? ` · a2a ${state.a2aMode}` : ""}
            </span>
          ) : null}
          {busy ? (
            <button
              type="button"
              onClick={cancel}
              className="sketch-pill border border-border-subtle px-3 py-1 text-xs"
            >
              관전 중단
            </button>
          ) : state.phase !== "idle" ? (
            <button type="button" onClick={reset} className="sketch-pill border border-border-subtle px-3 py-1 text-xs">
              화면 초기화
            </button>
          ) : null}
        </div>
      </section>

      {state.phase === "error" && state.error ? (
        <div className="sketch-alt ink border border-negative bg-background p-4 text-sm text-negative">{state.error}</div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <CampaignForm values={values} disabled={busy} error={formError} onChange={setValues} onSubmit={submit} />
        <div className="flex min-w-0 flex-col gap-5">
          <DiscoveryTable report={state.discovery} loading={busy} />
          <LedgerTiles ledger={state.ledger} />
        </div>
      </div>

      <section className="min-w-0">
        <div className="mb-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Negotiations</p>
          <h2 className="mt-1 text-3xl">협상 진행</h2>
        </div>
        {columns.length === 0 ? (
          <div className="sketch-alt ink border border-dashed border-border-subtle bg-background p-5">
            <p className="text-xl">{busy ? "후보를 고르는 중입니다" : "아직 협상이 없습니다"}</p>
            <p className="mt-2 text-sm text-muted">선정된 크리에이터마다 대화 열이 하나씩 열립니다.</p>
          </div>
        ) : (
          <div className="flex snap-x gap-4 overflow-x-auto pb-3">
            {columns.map((column) => (
              <NegotiationColumn key={column.creatorAgentId} column={column} />
            ))}
          </div>
        )}
      </section>

      {state.result ? <CampaignResultBanner result={state.result} promotionId={promotionId} /> : null}
    </div>
  );
}

function PhasePill({ phase }: { phase: ReturnType<typeof useCampaignStream>["state"]["phase"] }) {
  if (phase === "idle") return <Pill tone="muted">대기</Pill>;
  if (phase === "connecting") return <Pill tone="caution">연결 중</Pill>;
  if (phase === "running") return <Pill tone="accent">진행 중</Pill>;
  if (phase === "done") return <Pill tone="positive">종료</Pill>;
  return <Pill tone="negative">오류</Pill>;
}

function PanelMessage({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="sketch ink my-8 w-full border border-border-subtle bg-surface p-5">
      <p className="text-2xl">{title}</p>
      <p className="mt-2 text-sm text-muted">{body}</p>
      {action ? (
        <Link href={action.href} className="sketch-pill mt-4 inline-flex bg-accent px-4 py-2 text-background">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

function readableError(caught: unknown) {
  if (caught instanceof ProductApiError) return caught.message;
  if (caught instanceof Error) return caught.message;
  return String(caught);
}
