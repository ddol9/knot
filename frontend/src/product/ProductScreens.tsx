"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AgentCharacter } from "@/components/AgentCharacter";
import { useAuth } from "@/auth/AuthProvider";
import { postLoginPath, safeRedirectPath } from "@/auth/authState";
import {
  authConfigurationError,
  createFirebaseAccount,
  currentIdToken,
  firebaseAuthErrorMessage,
  firebaseConfigured,
  signInWithEmail,
  signInWithGoogle,
} from "@/auth/firebaseClient";
import {
  ProductApiClient,
  ProductApiError,
  type ApiAgreement,
  type ApiCandidate,
  type ApiDemoBrandPersona,
  type ApiDemoCreatorPersona,
  type ApiDevDemoPersonas,
  type ApiNegotiation,
  type ApiNegotiationMessage,
  type ApiDevAdminOverview,
  type ApiMatchRun,
  type ApiTimelineEvent,
  type BrandDashboard,
  type CreatorAgentControl,
  type CreatorDashboard,
  type CurrentUserContext,
} from "./apiClient";
import { A2ANegotiationVisualizer } from "./A2AVisualizer";
import { brandWorkspaceRoutes, creatorWorkspaceRoutes } from "./flow";
import {
  agreementMilestones,
  calculateBrandEscrow,
  calculateCreatorSettlement,
  mapTaskStateToCreatorStatus,
  normalizeNegotiationEvents,
  productSnapshotFromPromotion,
  promotionProgress,
} from "./mvp";
import type {
  AgentTask,
  AgentRunEvent,
  BrandProduct,
  CreatorCriteria,
  CreatorDeal,
  DevOverview,
  Milestone,
  NegotiationView,
  Role,
  RoleSession,
  Settlement,
  TechnicalProofItem,
} from "./types";

ProductApiClient.setAuthTokenProvider(currentIdToken);

function uniqueRequestKey(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type WorkspacePage =
  | "dashboard"
  | "onboarding"
  | "product"
  | "criteria"
  | "negotiation"
  | "result"
  | "settlement"
  | "me"
  | "settings";

export function LandingScreen() {
  return (
    <div className="flex flex-col gap-14 py-8 md:py-14">
      <section className="grid min-h-[68vh] items-center gap-10 lg:grid-cols-[1fr_0.95fr]">
        <div className="flex flex-col gap-7">
          <div className="flex flex-wrap items-center gap-2">
            <Pill>KNOT</Pill>
            <Pill>Agent-to-Agent commerce</Pill>
          </div>
          <div>
            <p className="text-lg font-semibold text-muted">지금까지의 협업은 이랬어요</p>
            <h1 className="mt-3 max-w-4xl text-5xl font-semibold leading-[0.95] md:text-7xl">
              브랜드는 DM을 50개 보내고, 답장은 3개 받아요.
            </h1>
            <div className="mt-6 max-w-2xl space-y-2 text-xl leading-relaxed">
              <p>크리에이터는 제안을 놓치고, 단가는 눈치게임,</p>
              <p>정산은 엑셀과 계좌이체로 끝나죠.</p>
            </div>
            <p className="mt-6 max-w-2xl text-2xl font-semibold leading-relaxed">
              크리에이터랑 브랜드, 에이전트끼리 만나서 매듭 짓는 곳
            </p>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
              당신이 자는 동안, 당신의 에이전트가 딜을 협상하고, 계약하고, 정산합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <PrimaryLink href="/login">로그인</PrimaryLink>
            <SecondaryLink href="/signup">회원가입</SecondaryLink>
            <SecondaryLink href="/dev/admin">Dev admin</SecondaryLink>
          </div>
        </div>

        <Panel>
          <AgentRelayScene />
        </Panel>
      </section>
    </div>
  );
}

export function LoginScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const configured = firebaseConfigured();
  const redirect = safeRedirectPath(searchParams.get("redirect"));

  async function submit(formData: FormData) {
    setStatus("saving");
    setError(null);
    try {
      if (!configured) throw new Error(authConfigurationError());
      const email = String(formData.get("email") ?? "");
      const password = String(formData.get("password") ?? "");
      await signInWithEmail(email, password);
      const account = await new ProductApiClient().getMe();
      saveCurrentAccount(account);
      router.push(postLoginPath(account.account, account.dashboardTarget, redirect));
    } catch (caught) {
      setError(firebaseAuthErrorMessage(caught));
      setStatus("idle");
    }
  }

  async function google() {
    setStatus("saving");
    setError(null);
    try {
      if (!configured) throw new Error(authConfigurationError());
      await signInWithGoogle();
      const account = await new ProductApiClient().getMe();
      saveCurrentAccount(account);
      router.push(postLoginPath(account.account, account.dashboardTarget, redirect));
    } catch (caught) {
      setError(firebaseAuthErrorMessage(caught));
      setStatus("idle");
    }
  }

  return (
    <AuthFrame
      eyebrow="Sign in"
      title="계정으로 로그인"
      body="로그인하면 계정 역할에 맞는 대시보드로 이동합니다."
    >
      <Panel>
        <form action={submit} className="grid gap-4">
          <Input label="Email" name="email" placeholder="you@company.com" type="email" required />
          <Input label="Password" name="password" placeholder="Password" type="password" minLength={6} required />
          <button
            type="submit"
            className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-background"
            disabled={status === "saving" || !configured}
          >
            {status === "saving" ? "Signing in..." : "Continue"}
          </button>
          <button
            type="button"
            onClick={google}
            disabled={status === "saving" || !configured}
            className="rounded-full border border-border-subtle bg-surface-raised px-5 py-3 text-sm font-semibold text-muted"
          >
            Continue with Google
          </button>
          {!configured && <FormError message={authConfigurationError()} />}
          {error && <FormError message={error} />}
        </form>
        <p className="mt-5 text-sm text-muted">
          계정이 없으면 <Link className="font-semibold text-foreground" href="/signup">회원가입</Link>에서 역할을 선택하세요.
        </p>
      </Panel>
      <div className="grid gap-4 md:grid-cols-2">
        <RoleJumpCard role="brand" title="Brand workspace" href="/brand" />
        <RoleJumpCard role="creator" title="Creator workspace" href="/creator/connect" />
      </div>
    </AuthFrame>
  );
}

export function SignupScreen() {
  return (
    <AuthFrame
      eyebrow="Create account"
      title="역할을 선택하세요"
      body="브랜드는 기본 프로필만 만든 뒤 대시보드로 이동하고, 크리에이터는 협찬 수신 조건을 먼저 설정합니다."
    >
      <div className="grid gap-5 md:grid-cols-2">
        <RoleChoiceCard
          role="brand"
          title="브랜드로 시작"
          body="브랜드 정보와 제품 제안서를 만들고, Brand Agent가 크리에이터를 찾아 협상합니다."
          href="/signup/brand"
        />
        <RoleChoiceCard
          role="creator"
          title="크리에이터로 시작"
          body="SNS URL reference를 저장하고 협상 기준을 정하면, Creator Agent가 제안을 선별합니다."
          href="/signup/creator"
        />
      </div>
    </AuthFrame>
  );
}

export function BrandDashboardScreen({ context }: { context: CurrentUserContext }) {
  const [state, setState] = useDashboardState<BrandDashboard>();
  const reload = useCallback(
    () => loadDashboard(() => new ProductApiClient().getBrandDashboard(), setState),
    [setState],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <WorkspaceShell role="brand" active="dashboard" title="브랜드 대시보드" session={null}>
      <DashboardStatus state={state} retry={reload}>
        {(dashboard) => (
          <div className="grid gap-5">
            <div className="grid gap-3 md:grid-cols-4">
              <Metric label="진행 중인 프로모션" value={dashboard.summary.activePromotions} />
              <Metric label="진행 중인 협상" value={dashboard.summary.negotiationsInProgress} />
              <Metric label="체결된 크리에이터" value={dashboard.summary.agreements} />
              <Metric label="에스크로 예치" value={`${baseUnitsToUsdc(dashboard.summary.lockedEscrowBaseUnits)} USDC`} />
            </div>
            <BrandAgentControlRoom dashboard={dashboard} onReload={reload} />
            <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
              <Panel>
                <SectionTitle eyebrow="Promotions" title="내 프로모션" />
                {dashboard.activePromotions.length ? (
                  <div className="mt-4 grid gap-3">
                    {dashboard.activePromotions.map((promotion) => {
                      const product = productSnapshotFromPromotion(promotion);
                      return (
                        <div key={promotion.promotionId} className="grid gap-2 rounded border border-border-subtle bg-surface p-2">
                          <PromotionSummaryCard
                            promotion={promotion}
                            productName={product.name}
                            productCategory={product.category ?? promotion.category}
                          />
                          <DeletePromotionButton promotionId={promotion.promotionId} onDeleted={reload} />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState text="아직 생성한 프로모션이 없습니다." />
                )}
                <div className="mt-5">
                  <PrimaryLink href="/brand/promotions/new">첫 프로모션 만들기</PrimaryLink>
                </div>
              </Panel>
              <Panel>
                <SectionTitle eyebrow="Negotiations" title="최근 협상" />
                {dashboard.recentAgentActivity.length ? (
                  <div className="mt-4 grid gap-3">
                    {dashboard.recentAgentActivity.slice(0, 5).map((event) => (
                      <DashboardRow
                        key={event.eventId}
                        title={event.type}
                        meta={event.createdAt}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState text={`${context.account.displayName ?? "Brand"} 계정에서 아직 협상 기록이 없습니다.`} />
                )}
              </Panel>
            </div>
            <Panel>
              <SectionTitle eyebrow="Agreements" title="진행 중인 계약 및 에스크로" />
              <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
                {dashboard.contractedCreators.length ? (
                  <div className="mt-4 grid gap-3">
                    {dashboard.contractedCreators.map((creator) => (
                      <DashboardRow
                        key={String(creator.creatorId)}
                        title={String(creator.displayName ?? "Creator")}
                        meta={stringList(creator.categories).join(", ") || "category pending"}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState text="아직 계약 완료된 Creator가 없습니다." />
                )}
                <div className="rounded border border-border-subtle bg-background p-4">
                  <InfoBox label="lockedAmount" value={`${baseUnitsToUsdc(dashboard.summary.lockedEscrowBaseUnits)} USDC`} />
                  <p className="mt-3 text-sm text-muted">
                    Agent API spend와 Creator 보수 escrow는 분리해서 표시합니다. 이 카드는 계약 보수 escrow만 집계합니다.
                  </p>
                </div>
              </div>
            </Panel>
          </div>
        )}
      </DashboardStatus>
    </WorkspaceShell>
  );
}

export function CreatorDashboardScreen({ context }: { context: CurrentUserContext }) {
  const [state, setState] = useDashboardState<CreatorDashboard>();
  const creatorLabel = context.account.displayName ?? "Creator";

  useEffect(() => {
    void loadDashboard(() => new ProductApiClient().getCreatorDashboard(), setState);
  }, [setState]);

  return (
    <WorkspaceShell role="creator" active="dashboard" title="크리에이터 대시보드" session={null}>
      <DashboardStatus state={state} retry={() => loadDashboard(() => new ProductApiClient().getCreatorDashboard(), setState)}>
        {(dashboard) => (
          <div className="grid gap-5">
            <CreatorAgentAvailabilityCard />
            <CreatorReplayCard dashboard={dashboard} />
            <Panel>
              <SectionTitle eyebrow="Settlement" title="현재 정산 가능 금액" />
              {(() => {
                const summary = creatorDashboardSettlement(dashboard.activeSponsorships);
                return (
                  <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.7fr]">
                    <div>
                      <div className="text-5xl font-semibold">{summary.availableToClaimAmount} USDC</div>
                      <p className="mt-2 text-sm text-muted">
                        {summary.availableToClaimAmount > 0
                          ? `${summary.availableToClaimAmount} USDC 정산 가능`
                          : "현재 정산 가능한 금액이 없습니다."}
                      </p>
                    </div>
                    <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-1">
                      <InfoBox label="지급 완료" value={`${summary.paidAmount} USDC`} />
                      <InfoBox label="지급 대기" value={`${summary.pendingAmount} USDC`} />
                      <InfoBox label="지갑 상태" value="연결 필요" />
                    </div>
                    <div className="flex flex-wrap gap-3 lg:col-span-2">
                      <SecondaryLink href="/creator/settlements">정산내역</SecondaryLink>
                      <button
                        type="button"
                        disabled
                        className="rounded-full border border-border-subtle bg-surface-raised px-5 py-2.5 text-sm font-semibold text-muted"
                        title="정산이 확인되기 전까지 완료로 표시하지 않습니다."
                      >
                        지갑 연결 후 정산 가능
                      </button>
                    </div>
                  </div>
                );
              })()}
            </Panel>
            <Panel>
              <SectionTitle eyebrow="Promotions" title="내가 참여 중인 프로모션" />
              {dashboard.activeSponsorships.length ? (
                <div className="mt-4 grid gap-3">
                  {dashboard.activeSponsorships.map((agreement) => {
                    const milestones = agreementMilestones(agreement as unknown as ApiAgreement & Record<string, unknown>);
                    const completed = milestones.filter((milestone) => ["VERIFIED", "RELEASED"].includes(milestone.status)).length;
                    const progress = milestones.length ? Math.round((completed / milestones.length) * 100) : 0;
                    const settlement = calculateCreatorSettlement(milestones);
                    return (
                      <Link
                        key={String(agreement.agreementId)}
                        href={`/creator/agreements/${String(agreement.agreementId)}`}
                        className="rounded border border-border-subtle bg-background p-4 hover:bg-surface-raised"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">{String(agreement.title ?? "Promotion")}</div>
                            <div className="mt-1 text-sm text-muted">
                              마일스톤 {completed} / {milestones.length} · 지급 완료 {settlement.paidAmount} USDC · 지급 대기 {settlement.pendingAmount} USDC
                            </div>
                          </div>
                          <span className="font-mono text-xs uppercase text-muted">{String(agreement.status ?? "ACTIVE")}</span>
                        </div>
                        <div className="mt-4">
                          <ProgressBar progress={progress} />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <EmptyState text={`${creatorLabel} 계정에서 아직 참여 중인 프로모션이 없습니다.`} />
              )}
            </Panel>
            <Panel>
              <SectionTitle eyebrow="Agent Deals" title="Agent 체결 내역" />
              {dashboard.offers.length ? (
                <div className="mt-4 grid gap-3">
                  {dashboard.offers.map((offer) => (
                    <DashboardRow
                      key={String(offer.negotiationId)}
                      title={`${String(offer.brandName ?? "Brand")} · ${String(offer.title ?? "Promotion")}`}
                      meta={`${mapTaskStateToCreatorStatus(String(offer.taskState ?? ""), String(offer.status ?? ""))} · round ${String(offer.currentRound ?? "-")} · ${String(offer.currentAmountUsdc ?? offer.initialAmountUsdc ?? "-")} USDC`}
                      href={`/creator/offers/${String(offer.negotiationId)}`}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState text="아직 Agent 협상 기록이 없습니다. Agent 기준을 켜두면 적합한 제안을 자동으로 선별합니다." />
              )}
            </Panel>
          </div>
        )}
      </DashboardStatus>
    </WorkspaceShell>
  );
}

type BrandRunProjection = {
  promotion: BrandDashboard["activePromotions"][number] | null;
  matchRun: ApiMatchRun | null;
  candidates: ApiCandidate[];
  events: AgentRunEvent[];
  timeline: ApiTimelineEvent[];
  negotiationId: string | null;
  agreementId: string | null;
  proof: TechnicalProofItem[];
};

function BrandAgentControlRoom({
  dashboard,
  onReload,
}: {
  dashboard: BrandDashboard;
  onReload: () => void;
}) {
  const [state, setState] = useDashboardState<BrandRunProjection>();
  const action = useMutationLock();
  const [error, setError] = useState<string | null>(null);
  const promotion = dashboard.activePromotions[0] ?? null;
  const reload = useCallback(
    () => loadDashboard(() => loadBrandRunProjection(dashboard), setState),
    [dashboard, setState],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  async function runAgent() {
    if (!promotion) return;
    await action.run(async () => {
      setError(null);
      await new ProductApiClient().runAgentForPromotion(promotion.promotionId);
      await reload();
      onReload();
    }, (caught) => setError(errorMessage(caught)));
  }

  return (
    <DashboardStatus state={state} retry={reload}>
      {(projection) => {
        const product = projection.promotion ? productSnapshotFromPromotion(projection.promotion) : null;
        const selected = projection.candidates.find(
          (candidate) => candidate.creatorAgentId === projection.matchRun?.selectedCreatorAgentId,
        );
        const waitingForCreator = projection.matchRun?.status === "WAITING_FOR_CREATOR";
        const exhausted = Boolean(projection.matchRun) && !projection.matchRun?.selectedCreatorAgentId;
        const completed = projection.matchRun?.status === "COMPLETED" && Boolean(selected);
        const running = Boolean(projection.matchRun) && !["COMPLETED", "FAILED", "CANCELED", "WAITING_FOR_CREATOR"].includes(String(projection.matchRun?.status));
        return (
          <Panel>
            <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <SectionTitle
                  eyebrow="Brand Agent"
                  title={
                    !projection.promotion
                      ? "준비할 Promotion이 없습니다"
                      : completed
                        ? "협상 결과를 불러왔습니다"
                        : waitingForCreator
                          ? "Creator를 기다리고 있습니다"
                          : exhausted
                            ? "조건에 맞는 후보가 없습니다"
                          : running
                            ? "탐색이 진행 중입니다"
                            : "준비 완료"
                  }
                />
                {projection.promotion ? (
                  <div className="grid gap-3">
                    <InfoBox label="Product" value={product?.name ?? projection.promotion.title} />
                    <InfoBox label="Format" value={projection.promotion.deliverables.map((item) => `${item.format} x ${item.count}`).join(", ")} />
                    <InfoBox label="Target" value={`${projection.promotion.targetAudience.join(", ")} · 최대 ${projection.promotion.budget.maxPerCreatorUsdc} USDC`} />
                    <InfoBox label="Deadline" value={projection.promotion.postingWindow.end} />
                    {projection.matchRun && <InfoBox label="Match Run" value={`${projection.matchRun.matchRunId} · ${projection.matchRun.status}`} />}
                    {selected && <InfoBox label="Selected Creator" value={selected.creatorAgentId} />}
                    {projection.events.at(-1) && <InfoBox label="Last event" value={projection.events.at(-1)?.createdAt ?? ""} />}
                    {waitingForCreator && (
                      <InfoBox
                        label="대기 상태"
                        value="조건에 맞는 신규 Creator가 들어오면 다시 탐색할 수 있습니다"
                      />
                    )}
                    {exhausted && (
                      <InfoBox
                        label="Attempted candidates"
                        value={`${projection.candidates.length} · ${sanitizedFailureReasons(projection.candidates)}`}
                      />
                    )}
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={runAgent}
                        disabled={action.status === "submitting" || completed || running}
                        className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-background disabled:opacity-60"
                      >
                        {action.status === "submitting" ? "실행 중..." : completed ? "협상 완료" : waitingForCreator ? "다시 탐색" : "탐색·협상 시작"}
                      </button>
                      <button
                        type="button"
                        onClick={reload}
                        className="rounded-full border border-border-subtle bg-surface-raised px-5 py-2.5 text-sm font-semibold text-muted"
                      >
                        새로고침
                      </button>
                      {projection.negotiationId && (
                        <SecondaryLink href={`/brand/negotiations/${projection.negotiationId}`}>실시간으로 보기</SecondaryLink>
                      )}
                      {projection.agreementId && (
                        <PrimaryLink href={`/brand/agreements/${projection.agreementId}`}>협업 보기</PrimaryLink>
                      )}
                    </div>
                    {error && <FormError message={error} />}
                  </div>
                ) : (
                  <EmptyState text="Promotion을 만들면 Brand Agent가 후보 탐색과 협상을 시작할 수 있습니다." />
                )}
              </div>
              <div className="grid gap-4">
                <CandidateReplay candidates={projection.candidates} selectedCreatorAgentId={projection.matchRun?.selectedCreatorAgentId ?? null} />
                <CanonicalRunReplay events={projection.events} />
                <TechnicalProofPanel items={projection.proof} />
              </div>
            </div>
          </Panel>
        );
      }}
    </DashboardStatus>
  );
}

function CreatorAgentAvailabilityCard() {
  const [state, setState] = useDashboardState<{
    agent: CreatorAgentControl;
    discoveryProfile: Record<string, unknown> | null;
  }>();
  const action = useMutationLock();
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(
    () => loadDashboard(() => new ProductApiClient().getCreatorAgent(), setState),
    [setState],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  async function setAcceptingOffers(accepting: boolean) {
    await action.run(async () => {
      setError(null);
      const client = new ProductApiClient();
      if (accepting) {
        const current = state.type === "ready" ? state.data.agent : null;
        if (current?.publicationStatus === "PAUSED") await client.resumeCreatorAgent();
        else await client.publishCreatorAgent();
      } else {
        await client.pauseCreatorAgent();
      }
      await reload();
    }, (caught) => setError(errorMessage(caught)));
  }

  return (
    <DashboardStatus state={state} retry={reload}>
      {({ agent, discoveryProfile }) => {
        const isOn = agent.acceptingOffers && agent.publicationStatus === "PUBLISHED";
        return (
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <SectionTitle eyebrow="Creator Agent" title={isOn ? "제안 받는 중" : "제안 수신 꺼짐"} />
                <p className="text-sm leading-6 text-muted">
                  최소 기준과 일정은 비공개로 지켜집니다. 브랜드의 제안이 오면 사이트를 닫아도 협상합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAcceptingOffers(!isOn)}
                disabled={action.status === "submitting"}
                className={[
                  "rounded-full px-5 py-2.5 text-sm font-semibold disabled:opacity-60",
                  isOn ? "border border-border-subtle bg-surface-raised text-muted" : "bg-accent text-background",
                ].join(" ")}
              >
                {action.status === "submitting" ? "저장 중..." : isOn ? "제안 받기 OFF" : "제안 받기 ON"}
              </button>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-4">
              <InfoBox label="Publication" value={agent.publicationStatus} />
              <InfoBox label="Availability" value={agent.availability} />
              <InfoBox label="Active negotiations" value={`${agent.activeNegotiations}/${agent.maxConcurrentNegotiations}`} />
              <InfoBox label="Discovery profile" value={discoveryProfile ? "published projection" : "not published"} />
            </div>
            {error && <FormError message={error} />}
          </Panel>
        );
      }}
    </DashboardStatus>
  );
}

function CreatorReplayCard({ dashboard }: { dashboard: CreatorDashboard }) {
  const firstOfferId = dashboard.offers
    .map((offer) => String(offer.negotiationId ?? ""))
    .find(Boolean);
  const [state, setState] = useDashboardState<{
    negotiation: ApiNegotiation;
    events: AgentRunEvent[];
    proof: TechnicalProofItem[];
  }>();
  const reload = useCallback(async () => {
    if (!firstOfferId) {
      setState({ type: "empty", message: "아직 replay할 Agent 협상이 없습니다." });
      return;
    }
    await loadDashboard(async () => {
      const client = new ProductApiClient();
      const detail = await client.getCreatorOfferDetail(firstOfferId);
      const events = await client.listMatchRunEvents(detail.negotiation.matchRunId);
      return {
        negotiation: detail.negotiation,
        events: controlEventsFromTimeline(events),
        proof: [
          { label: "Data source", value: "LIVE", status: "ok" },
          { label: "Match Run ID", value: detail.negotiation.matchRunId, status: "ok" },
          { label: "A2A context ID", value: detail.negotiation.contextId, status: "ok" },
          { label: "협상 기록", value: detail.negotiation.taskId, status: "ok" },
        ] satisfies TechnicalProofItem[],
      };
    }, setState);
  }, [firstOfferId, setState]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (state.type === "empty") {
    return (
      <Panel>
        <SectionTitle eyebrow="Replay" title="최근 Agent 협상" />
        <EmptyState text={state.message} />
      </Panel>
    );
  }

  return (
    <DashboardStatus state={state} retry={reload}>
      {({ negotiation, events, proof }) => (
        <Panel>
          <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <SectionTitle eyebrow="Replay" title="최근 Agent 협상" />
              <div className="grid gap-3">
                <InfoBox label="Brand/product" value={negotiation.promotionId} />
                <InfoBox label="Current offer" value={`${negotiation.currentTerms.compensation.baseAmountUsdc} USDC`} />
                <InfoBox label="Round" value={`${negotiation.currentRound}/${negotiation.maxRounds}`} />
                <SecondaryLink href={`/creator/offers/${negotiation.negotiationId}`}>실시간으로 보기</SecondaryLink>
              </div>
              <p className="mt-4 text-sm text-muted">사이트를 나가도 협상은 계속됩니다. 다시 열면 같은 Task와 event history를 불러옵니다.</p>
            </div>
            <div className="grid gap-4">
              <CanonicalRunReplay events={events} />
              <TechnicalProofPanel items={proof} />
            </div>
          </div>
        </Panel>
      )}
    </DashboardStatus>
  );
}

async function loadBrandRunProjection(dashboard: BrandDashboard): Promise<BrandRunProjection> {
  const promotion = dashboard.activePromotions[0] ?? null;
  if (!promotion) {
    return {
      promotion: null,
      matchRun: null,
      candidates: [],
      events: [],
      timeline: dashboard.recentAgentActivity,
      negotiationId: null,
      agreementId: null,
      proof: [{ label: "Data source", value: "LIVE", status: "pending" }],
    };
  }

  const client = new ProductApiClient();
  const timeline = await client.getTimeline(promotion.promotionId);
  const matchRunId = latestTimelineString(timeline, "MATCH_RUN_COMPLETED", "matchRunId");
  const negotiationId = latestTimelineString(timeline, "NEGOTIATION_STARTED", "negotiationId");
  const agreementId = latestTimelineString(timeline, "AGREEMENT_CREATED", "agreementId");
  if (!matchRunId) {
    return {
      promotion,
      matchRun: null,
      candidates: [],
      events: [],
      timeline,
      negotiationId,
      agreementId,
      proof: [
        { label: "Data source", value: "LIVE", status: "ok" },
        { label: "Promotion ID", value: promotion.promotionId, status: "ok" },
        { label: "Match Run ID", value: "pending", status: "pending" },
      ],
    };
  }

  const [matchRun, candidates, runEvents] = await Promise.all([
    client.getMatchRun(matchRunId),
    client.listCandidates(matchRunId),
    client.listMatchRunEvents(matchRunId),
  ]);
  const events = controlEventsFromTimeline(runEvents);
  const selected = candidates.find((candidate) => candidate.creatorAgentId === matchRun.selectedCreatorAgentId);
  return {
    promotion,
    matchRun,
    candidates,
    events,
    timeline,
    negotiationId,
    agreementId,
    proof: [
      { label: "Data source", value: "LIVE", status: "ok" },
      { label: "Promotion ID", value: promotion.promotionId, status: "ok" },
      { label: "Match Run ID", value: matchRun.matchRunId, status: "ok" },
      { label: "Candidate snapshot", value: `${candidates.length} candidates · selected ${selected?.creatorAgentId ?? "none"}`, status: candidates.length ? "ok" : "pending" },
      { label: "Run event sequence", value: events.map((event) => `${event.sequence ?? "-"}:${event.type}`).join(" -> "), status: events.length ? "ok" : "pending" },
      { label: "Negotiation ID", value: negotiationId ?? "pending", status: negotiationId ? "ok" : "pending" },
      { label: "Agreement ID", value: agreementId ?? "pending", status: agreementId ? "ok" : "pending" },
    ],
  };
}

function CandidateReplay({
  candidates,
  selectedCreatorAgentId,
}: {
  candidates: ApiCandidate[];
  selectedCreatorAgentId: string | null;
}) {
  if (!candidates.length) {
    return <EmptyState text="저장된 candidate snapshot이 아직 없습니다." />;
  }
  return (
    <div className="rounded border border-border-subtle bg-background p-4">
      <div className="font-mono text-xs uppercase text-muted">Candidate snapshots</div>
      <div className="mt-3 grid gap-2">
        {candidates.slice(0, 3).map((candidate) => (
          <div
            key={candidate.creatorAgentId}
            className={[
              "rounded border p-3 text-sm",
              candidate.creatorAgentId === selectedCreatorAgentId
                ? "border-accent bg-surface-raised"
                : "border-border-subtle bg-surface",
            ].join(" ")}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{candidate.creatorAgentId}</span>
              <span className="font-mono text-xs text-muted">rank {candidate.rank ?? "-"} · score {scoreLabel(candidate)}</span>
            </div>
            <p className="mt-1 text-muted">{candidate.explanation ?? candidate.hardFilterReasons?.join(", ") ?? "stored candidate snapshot"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CanonicalRunReplay({ events }: { events: AgentRunEvent[] }) {
  if (!events.length) {
    return <EmptyState text="저장된 Match Run 이벤트가 아직 없습니다." />;
  }
  return (
    <div className="rounded border border-border-subtle bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-xs uppercase text-muted">Live / replay</div>
          <div className="mt-1 font-semibold">Canonical event sequence</div>
        </div>
        <span className="rounded-full border border-border-subtle px-3 py-1 font-mono text-xs text-muted">LIVE</span>
      </div>
      <div className="mt-4 grid gap-2">
        {events.map((event) => (
          <div key={event.id} className="rounded border border-border-subtle bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{event.sequence ?? "-"} · {event.label}</span>
              <span className="font-mono text-[11px] text-muted">{event.createdAt}</span>
            </div>
            <div className="mt-1 font-mono text-[11px] uppercase text-muted">{event.type}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TechnicalProofPanel({ items }: { items: TechnicalProofItem[] }) {
  return (
    <details className="rounded border border-border-subtle bg-background p-4">
      <summary className="cursor-pointer text-sm font-semibold">Technical Proof</summary>
      <div className="mt-4 grid gap-2">
        {items.map((item) => (
          <div key={item.label} className="grid gap-1 rounded border border-border-subtle bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase text-muted">{item.label}</span>
              <span className={`font-mono text-[11px] uppercase ${item.status === "ok" ? "text-positive" : item.status === "warning" ? "text-caution" : "text-muted"}`}>
                {item.status}
              </span>
            </div>
            <span className="break-all text-sm font-semibold">{item.value}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function controlEventsFromTimeline(events: ApiTimelineEvent[]): AgentRunEvent[] {
  return events.map((event, index) => ({
    id: event.eventId,
    type: event.type,
    label: controlEventLabel(event),
    createdAt: event.createdAt,
    sequence: typeof event.sequence === "number" ? event.sequence : index + 1,
    status: event.type.includes("FAILED") || event.type.includes("CANCELED") ? "warning" : "ok",
  }));
}

function controlEventLabel(event: ApiTimelineEvent) {
  switch (event.type) {
    case "MATCH_RUN_READY":
      return "조건을 검색 기준으로 바꿨어요.";
    case "MATCH_RUN_DISCOVERING":
      return "제안 가능한 Creator Agent를 찾았어요.";
    case "MATCH_RUN_RANKING":
      return "제품 분위기와 가까운 후보를 비교했어요.";
    case "MATCH_RUN_SELECTING":
      return "선택할 후보를 확정하고 있어요.";
    case "MATCH_RUN_COMPLETED": {
      const selected = typeof event.data.selectedCreatorAgentId === "string" ? event.data.selectedCreatorAgentId : null;
      return selected ? `${selected}를 선택했어요.` : "조건에 맞는 후보를 찾지 못했어요.";
    }
    case "MATCH_RUN_WAITING_FOR_CREATOR":
      return "조건에 맞는 Creator가 들어올 때까지 대기합니다.";
    case "MATCH_RUN_CANCELED":
      return "사용자가 Match Run을 취소했어요.";
    default:
      return event.type;
  }
}

function latestTimelineString(events: ApiTimelineEvent[], type: string, fieldName: string) {
  for (const event of [...events].reverse()) {
    if (event.type !== type) continue;
    const value = event.data[fieldName];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function scoreLabel(candidate: ApiCandidate) {
  if (typeof candidate.overallScore !== "number") return "-";
  return `${Math.round(candidate.overallScore * 100)}`;
}

function sanitizedFailureReasons(candidates: ApiCandidate[]) {
  const reasons = candidates
    .flatMap((candidate) => candidate.hardFilterReasons ?? [])
    .filter((reason, index, all) => all.indexOf(reason) === index)
    .slice(0, 3);
  return reasons.length ? reasons.join(", ") : "no public blocker";
}

export function BrandPromotionCreateScreen() {
  const router = useRouter();
  const createAction = useMutationLock();
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    const productName = formString(formData, "productName", "");
    if (!productName) {
      setError("제품명을 입력해주세요.");
      return;
    }
    await createAction.run(async () => {
      setError(null);
      const promotion = await new ProductApiClient().createBrandPromotion({
        productName,
        title: formString(formData, "title", `${productName} 크리에이터 프로모션`),
        objective: "제품 인지도 및 콘텐츠 확보",
        categories: ["Instagram"],
        targetAudience: "제품에 관심 있는 SNS 사용자",
        totalBudget: numberFromForm(formData, "totalBudget", 1000),
        initialOffer: numberFromForm(formData, "initialOffer", 300),
        maximumPerCreator: numberFromForm(formData, "maximumPerCreator", 500),
        autoAcceptCeiling: numberFromForm(formData, "autoAcceptCeiling", 400),
        maximumRounds: numberFromForm(formData, "maximumRounds", 3),
        deliverables: [{ format: "reel", count: 1 }],
        usageRights: formString(formData, "usageRights", "organicOnly"),
        deadline: formString(formData, "deadline", defaultDeadlineDate()),
        prohibitedClaims: [],
      }, createAction.idempotencyKey);
      router.push(`/brand/promotions/${promotion.promotionId}`);
    }, (caught) => setError(errorMessage(caught)));
  }

  return (
    <WorkspaceShell role="brand" active="product" title="새 Promotion" session={null}>
      <Panel>
        <form action={submit} className="grid gap-4">
          <SectionTitle eyebrow="Promotion" title="제품명만 입력하면 기본 조건으로 생성합니다" />
          <Input label="제품명" name="productName" placeholder="예: 글로우 립밤" required />
          <Input label="Promotion title" name="title" placeholder="비워두면 제품명 기준으로 자동 생성" />
          <div className="rounded border border-border-subtle bg-background p-4">
            <SectionTitle eyebrow="Default values" title="자동 설정될 조건" />
            <div className="grid gap-3 md:grid-cols-3">
              <InfoBox label="목표" value="제품 인지도 및 콘텐츠 확보" />
              <InfoBox label="총예산" value="1,000 USDC" />
              <InfoBox label="채널" value="Instagram" />
              <InfoBox label="콘텐츠" value="Reel 1개" />
              <InfoBox label="기준 협상 금액" value="300 USDC" />
              <InfoBox label="최대 협상 금액" value="500 USDC" />
              <InfoBox label="자동 승인 한도" value="400 USDC" />
              <InfoBox label="최대 라운드" value="3회" />
              <InfoBox label="상태" value="OPEN" />
            </div>
          </div>
          <details className="rounded border border-border-subtle bg-background p-4">
            <summary className="cursor-pointer text-sm font-semibold">세부 설정 변경</summary>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Input label="Total budget" name="totalBudget" type="number" placeholder="1000" defaultValue="1000" />
              <Input label="Initial offer" name="initialOffer" type="number" placeholder="300" defaultValue="300" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="mt-4 block text-sm font-semibold">
                Negotiation mode
                <select
                  name="negotiationMode"
                  className="mt-2 w-full rounded border border-border-subtle bg-background p-3 text-sm outline-none focus:border-accent"
                  defaultValue="balanced"
                >
                  <option value="conservative">보수적</option>
                  <option value="balanced">균형</option>
                  <option value="aggressive">적극적</option>
                </select>
              </label>
              <Input label="Maximum per Creator" name="maximumPerCreator" type="number" placeholder="500" defaultValue="500" />
              <Input label="Auto-accept ceiling" name="autoAcceptCeiling" type="number" placeholder="400" defaultValue="400" />
              <Input label="Maximum rounds" name="maximumRounds" type="number" placeholder="3" defaultValue="3" />
              <Input label="Deadline" name="deadline" type="date" placeholder={defaultDeadlineDate()} defaultValue={defaultDeadlineDate()} />
            </div>
            <label className="block text-sm font-semibold">
              Usage rights
              <select
                name="usageRights"
                className="mt-2 w-full rounded border border-border-subtle bg-background p-3 text-sm outline-none focus:border-accent"
                defaultValue="organicOnly"
              >
                <option value="organicOnly">Organic usage only</option>
                <option value="paidBoost30d">Paid boost up to 30 days</option>
                <option value="fullLicense90d">Full license up to 90 days</option>
              </select>
            </label>
          </details>
          <PrivacyNote>
            자동 승인 한도를 초과한 제안은 Agent가 수락하지 않고 사용자 승인을 요청합니다. 총예산, 자동 승인 한도, 사용권, 마감일은 사용자가 직접 확정합니다.
          </PrivacyNote>
          {error && <FormError message={error} />}
          <button
            type="submit"
            disabled={createAction.status === "submitting"}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-background disabled:opacity-60"
          >
            {createAction.status === "submitting" ? "프로모션 생성 중..." : "프로모션 생성"}
          </button>
        </form>
      </Panel>
    </WorkspaceShell>
  );
}

export function BrandPromotionListScreen() {
  const [state, setState] = useDashboardState<Awaited<ReturnType<ProductApiClient["listBrandPromotions"]>>>();
  const reload = useCallback(
    () => loadDashboard(() => new ProductApiClient().listBrandPromotions(), setState),
    [setState],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <WorkspaceShell role="brand" active="product" title="내 프로모션" session={null}>
      <DashboardStatus state={state} retry={reload}>
        {(promotions) => (
          <div className="grid gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">하나의 Brand Agent가 여러 Promotion을 관리합니다.</p>
              <PrimaryLink href="/brand/promotions/new">첫 프로모션 만들기</PrimaryLink>
            </div>
            {promotions.length ? (
              <div className="grid gap-3">
                {promotions.map((promotion) => {
                  const product = productSnapshotFromPromotion(promotion);
                  return (
                    <div key={promotion.promotionId} className="grid gap-2 rounded border border-border-subtle bg-surface p-2">
                      <PromotionSummaryCard
                        promotion={promotion}
                        productName={product.name}
                        productCategory={product.category ?? promotion.category}
                      />
                      <DeletePromotionButton promotionId={promotion.promotionId} onDeleted={reload} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <Panel>
                <EmptyState text="아직 생성한 프로모션이 없습니다." />
              </Panel>
            )}
          </div>
        )}
      </DashboardStatus>
    </WorkspaceShell>
  );
}

export function BrandPromotionDetailScreen({ promotionId }: { promotionId: string }) {
  const [state, setState] = useDashboardState<Awaited<ReturnType<ProductApiClient["getBrandPromotionDetail"]>>>();

  useEffect(() => {
    void loadDashboard(() => new ProductApiClient().getBrandPromotionDetail(promotionId), setState);
  }, [promotionId, setState]);

  return (
    <WorkspaceShell role="brand" active="product" title="Promotion Detail" session={null}>
      <DashboardStatus state={state} retry={() => loadDashboard(() => new ProductApiClient().getBrandPromotionDetail(promotionId), setState)}>
        {(detail) => (
          <div className="grid gap-5">
            <Panel>
              <SectionTitle eyebrow="Overview" title={detail.promotion.title} />
              <div className="mt-4 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded border border-border-subtle bg-background p-4">
                  <div className="flex items-center gap-4">
                    <div className="flex size-20 items-center justify-center rounded border border-border-subtle bg-surface font-mono text-xs text-muted">
                      IMG
                    </div>
                    <div>
                      <h3 className="text-2xl font-semibold">{productSnapshotFromPromotion(detail.promotion).name}</h3>
                      <p className="mt-1 text-sm text-muted">{productSnapshotFromPromotion(detail.promotion).category ?? detail.promotion.category}</p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-muted">
                    {productSnapshotFromPromotion(detail.promotion).summary ?? detail.promotion.objective}
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <InfoBox label="상태" value={detail.promotion.status} />
                  <InfoBox label="Promotion ID" value={detail.promotion.promotionId} />
                  <InfoBox label="목표" value={detail.promotion.objective} />
                  <InfoBox label="타깃" value={detail.promotion.targetAudience.join(", ")} />
                  <InfoBox label="예산" value={`${detail.promotion.budget.totalUsdc} USDC`} />
                  <InfoBox label="마감" value={detail.promotion.postingWindow.end} />
                  <InfoBox label="Brand Agent" value={detail.promotion.brandAgentId} />
                  <InfoBox label="자동 협상 라운드" value={String(detail.promotion.autonomy?.maxNegotiationRounds ?? "-")} />
                </div>
              </div>
            </Panel>
            <Panel>
              <SectionTitle eyebrow="Negotiations" title="협상 기록" />
              {detail.activity.length ? (
                <div className="mt-4 grid gap-3">
                  {detail.activity.map((event) => (
                    <DashboardRow key={event.eventId} title={event.type} meta={event.createdAt} />
                  ))}
                </div>
              ) : (
                <EmptyState text="아직 협상 기록이 없습니다. 후보 매칭 후 Brand Agent가 협상을 시작하면 여기에 기록됩니다." />
              )}
            </Panel>
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel>
                <SectionTitle eyebrow="Creators" title="체결된 크리에이터" />
                {(detail.agreements ?? (detail.agreement ? [detail.agreement] : [])).length ? (
                  <div className="grid gap-3">
                    {(detail.agreements ?? (detail.agreement ? [detail.agreement] : [])).map((agreement) => {
                      const milestones = agreementMilestones(agreement);
                      const completed = milestones.filter((milestone) => ["VERIFIED", "RELEASED"].includes(milestone.status)).length;
                      const progress = milestones.length ? Math.round((completed / milestones.length) * 100) : 0;
                      const settlement = calculateCreatorSettlement(milestones);
                      const creator = agreement.creatorSnapshot;
                      const creatorName = typeof creator === "object" && creator !== null && "displayName" in creator
                        ? String((creator as Record<string, unknown>).displayName)
                        : String(agreement.creatorAgentId);
                      return (
                        <Link
                          key={agreement.agreementId}
                          href={`/brand/agreements/${agreement.agreementId}`}
                          className="rounded border border-border-subtle bg-background p-4 hover:bg-surface-raised"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold">{creatorName}</div>
                              <div className="mt-1 text-sm text-muted">
                                마일스톤 {completed} / {milestones.length} · 정산 완료 {settlement.paidAmount} USDC · 정산 가능 {settlement.availableToClaimAmount} USDC
                              </div>
                            </div>
                            <span className="font-mono text-xs uppercase text-muted">{agreement.status}</span>
                          </div>
                          <div className="mt-4">
                            <ProgressBar progress={progress} />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState text="아직 체결된 Creator가 없습니다." />
                )}
              </Panel>
              <Panel>
                <SectionTitle eyebrow="Escrow" title="에스크로 및 마일스톤" />
                {detail.agreement ? (
                  <div className="mt-4 grid gap-3">
                    <InfoBox label="Agreement" value={detail.agreement.agreementId} />
                    <InfoBox label="termsHash" value={String(detail.agreement.termsHash ?? "not-created")} />
                    <InfoBox label="Milestones" value={String(detail.agreement.terms.milestones.length)} />
                    <PrimaryLink href={`/brand/agreements/${detail.agreement.agreementId}`}>계약 상세보기</PrimaryLink>
                  </div>
                ) : (
                  <EmptyState text="Agreement 생성 후 escrow와 milestone이 연결됩니다." />
                )}
              </Panel>
            </div>
            <Panel>
              <SectionTitle eyebrow="Agent Activity" title="Agent Activity" />
              {detail.activity.length ? (
                <div className="mt-4 grid gap-3">
                  {detail.activity.map((event) => (
                    <DashboardRow key={event.eventId} title={event.type} meta={event.createdAt} />
                  ))}
                </div>
              ) : (
                <EmptyState text="아직 Promotion activity가 없습니다." />
              )}
            </Panel>
          </div>
        )}
      </DashboardStatus>
    </WorkspaceShell>
  );
}

export function BrandAgreementDetailScreen({ agreementId }: { agreementId: string }) {
  return <AgreementResourceScreen role="brand" agreementId={agreementId} />;
}

export function CreatorAgreementDetailScreen({ agreementId }: { agreementId: string }) {
  return <AgreementResourceScreen role="creator" agreementId={agreementId} />;
}

export function CreatorOfferListScreen() {
  const [state, setState] = useDashboardState<Awaited<ReturnType<ProductApiClient["listCreatorOffers"]>>>();

  useEffect(() => {
    void loadDashboard(() => new ProductApiClient().listCreatorOffers(), setState);
  }, [setState]);

  return (
    <WorkspaceShell role="creator" active="negotiation" title="Agent 협상 기록" session={null}>
      <DashboardStatus state={state} retry={() => loadDashboard(() => new ProductApiClient().listCreatorOffers(), setState)}>
        {(offers) => (
          <div className="grid gap-4">
            {offers.length ? (
              offers.map((offer) => (
                <DashboardRow
                  key={String(offer.negotiationId)}
                  title={`${String(offer.brandName ?? "Brand")} · ${String(offer.title ?? "Promotion")}`}
                  meta={`${mapTaskStateToCreatorStatus(String(offer.taskState ?? ""), String(offer.status ?? ""))} · ${String(offer.currentAmountUsdc ?? offer.initialAmountUsdc ?? "-")} USDC`}
                  href={`/creator/offers/${String(offer.negotiationId)}`}
                />
              ))
            ) : (
              <Panel>
                <EmptyState text="아직 Agent가 처리한 제안이 없습니다." />
              </Panel>
            )}
          </div>
        )}
      </DashboardStatus>
    </WorkspaceShell>
  );
}

export function CreatorAgreementListScreen() {
  const [state, setState] = useDashboardState<Awaited<ReturnType<ProductApiClient["listCreatorAgreements"]>>>();

  useEffect(() => {
    void loadDashboard(() => new ProductApiClient().listCreatorAgreements(), setState);
  }, [setState]);

  return (
    <WorkspaceShell role="creator" active="result" title="체결된 협상" session={null}>
      <DashboardStatus state={state} retry={() => loadDashboard(() => new ProductApiClient().listCreatorAgreements(), setState)}>
        {(agreements) => (
          <div className="grid gap-4">
            {agreements.length ? (
              agreements.map((agreement) => (
                <DashboardRow
                  key={agreement.agreementId}
                  title={String(agreement.agreementId)}
                  meta={`${agreement.status} · ${agreement.terms.compensation.baseAmountUsdc} USDC`}
                  href={`/creator/agreements/${agreement.agreementId}`}
                />
              ))
            ) : (
              <Panel>
                <EmptyState text="아직 체결된 협상이 없습니다." />
              </Panel>
            )}
          </div>
        )}
      </DashboardStatus>
    </WorkspaceShell>
  );
}

export function CreatorSettlementScreen() {
  const [state, setState] = useDashboardState<Awaited<ReturnType<ProductApiClient["listCreatorAgreements"]>>>();

  useEffect(() => {
    void loadDashboard(() => new ProductApiClient().listCreatorAgreements(), setState);
  }, [setState]);

  return (
    <WorkspaceShell role="creator" active="settlement" title="정산" session={null}>
      <DashboardStatus state={state} retry={() => loadDashboard(() => new ProductApiClient().listCreatorAgreements(), setState)}>
        {(agreements) => {
          const summary = creatorDashboardSettlement(agreements);
          return (
            <div className="grid gap-5">
              <Panel>
                <SectionTitle eyebrow="Settlement" title="정산 요약" />
                <div className="mt-4 grid gap-3 md:grid-cols-5">
                  <InfoBox label="전체 계약" value={`${summary.paidAmount + summary.availableToClaimAmount + summary.pendingAmount} USDC`} />
                  <InfoBox label="현재 정산 가능" value={`${summary.availableToClaimAmount} USDC`} />
                  <InfoBox label="지급 완료" value={`${summary.paidAmount} USDC`} />
                  <InfoBox label="조건 미달" value={`${summary.pendingAmount} USDC`} />
                  <InfoBox label="지갑" value="연결 필요" />
                </div>
                <div className="mt-5 rounded border border-border-subtle bg-background p-4 text-sm text-muted">
                  정산이 확인되기 전까지 완료된 금액처럼 표시하지 않습니다.
                </div>
              </Panel>
              <Panel>
                <SectionTitle eyebrow="History" title="정산내역" />
                {agreements.length ? (
                  <div className="mt-4 grid gap-3">
                    {agreements.map((agreement) => {
                      const milestones = agreementMilestones(agreement as unknown as ApiAgreement & Record<string, unknown>);
                      const settlement = calculateCreatorSettlement(milestones);
                      return (
                        <DashboardRow
                          key={String(agreement.agreementId)}
                          title={String(agreement.title ?? agreement.agreementId ?? "Agreement")}
                          meta={`정산 가능 ${settlement.availableToClaimAmount} USDC · 지급 완료 ${settlement.paidAmount} USDC · 지급 대기 ${settlement.pendingAmount} USDC`}
                          href={`/creator/agreements/${String(agreement.agreementId)}`}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState text="아직 정산내역이 없습니다." />
                )}
              </Panel>
            </div>
          );
        }}
      </DashboardStatus>
    </WorkspaceShell>
  );
}

export function CreatorOfferDetailScreen({ negotiationId }: { negotiationId: string }) {
  const [state, setState] = useDashboardState<{
    detail: Awaited<ReturnType<ProductApiClient["getCreatorOfferDetail"]>>;
    messages: ApiNegotiationMessage[];
  }>();

  useEffect(() => {
    void loadDashboard(async () => {
      const client = new ProductApiClient();
      const [detail, messages] = await Promise.all([
        client.getCreatorOfferDetail(negotiationId),
        client.listNegotiationMessages(negotiationId),
      ]);
      return { detail, messages };
    }, setState);
  }, [negotiationId, setState]);

  return (
    <WorkspaceShell role="creator" active="negotiation" title="Offer Detail" session={null}>
      <DashboardStatus
        state={state}
        retry={() =>
          loadDashboard(async () => {
            const client = new ProductApiClient();
            const [detail, messages] = await Promise.all([
              client.getCreatorOfferDetail(negotiationId),
              client.listNegotiationMessages(negotiationId),
            ]);
            return { detail, messages };
          }, setState)
        }
      >
        {({ detail, messages }) => {
          const events = normalizeNegotiationEvents(messages, fallbackForNegotiation(detail.negotiation));
          return (
          <div className="grid gap-5">
            <div className="grid gap-5 lg:grid-cols-[0.8fr_1fr]">
            <Panel>
              <SectionTitle eyebrow="Offer" title={String(detail.offer.title ?? "Offer")} />
              <div className="mt-4 grid gap-3">
                <InfoBox label="Negotiation ID" value={String(detail.offer.negotiationId)} />
                <InfoBox label="Status" value={mapTaskStateToCreatorStatus(String(detail.offer.taskState ?? ""), String(detail.offer.status ?? detail.negotiation.status))} />
                <InfoBox label="Round" value={String(detail.offer.currentRound ?? "-")} />
                <InfoBox label="Latest offer" value={`${String(detail.offer.currentAmountUsdc ?? detail.negotiation.currentTerms?.compensation?.baseAmountUsdc ?? "-")} USDC`} />
              </div>
            </Panel>
            <Panel>
              <SectionTitle eyebrow="Sanitized terms" title="Agent 협상 상태" />
              <pre className="mt-4 overflow-auto rounded border border-border-subtle bg-background p-4 text-xs">
                {JSON.stringify(detail.negotiation.currentTerms ?? {}, null, 2)}
              </pre>
            </Panel>
            </div>
            <A2ANegotiationVisualizer events={events} />
          </div>
        );}}
      </DashboardStatus>
    </WorkspaceShell>
  );
}

export function BrandNegotiationDetailScreen({ negotiationId }: { negotiationId: string }) {
  const [state, setState] = useDashboardState<{
    negotiation: ApiNegotiation;
    messages: ApiNegotiationMessage[];
  }>();

  const load = useCallback(async () => {
    const client = new ProductApiClient();
    const [negotiation, messages] = await Promise.all([
      client.getNegotiation(negotiationId),
      client.listNegotiationMessages(negotiationId),
    ]);
    return { negotiation, messages };
  }, [negotiationId]);

  useEffect(() => {
    void loadDashboard(load, setState);
  }, [load, setState]);

  return (
    <WorkspaceShell role="brand" active="negotiation" title="협상 상세" session={null}>
      <DashboardStatus state={state} retry={() => loadDashboard(load, setState)}>
        {({ negotiation, messages }) => {
          const events = normalizeNegotiationEvents(messages, fallbackForNegotiation(negotiation));
          return (
            <div className="grid gap-5">
              <Panel>
                <SectionTitle eyebrow="Negotiation" title={negotiation.negotiationId} />
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <InfoBox label="상태" value={negotiation.status} />
                  <InfoBox label="라운드" value={`${negotiation.currentRound}/${negotiation.maxRounds}`} />
                  <InfoBox label="제안 금액" value={`${negotiation.currentTerms.compensation.baseAmountUsdc} USDC`} />
                  <InfoBox label="협상 기록" value={negotiation.taskId} />
                </div>
              </Panel>
              <A2ANegotiationVisualizer events={events} />
              <Panel>
                <SectionTitle eyebrow="Visible terms" title="최초 조건과 최신 조건" />
                <pre className="mt-4 overflow-auto rounded border border-border-subtle bg-background p-4 text-xs">
                  {JSON.stringify(negotiation.currentTerms, null, 2)}
                </pre>
              </Panel>
            </div>
          );
        }}
      </DashboardStatus>
    </WorkspaceShell>
  );
}

function AgreementResourceScreen({ role, agreementId }: { role: Role; agreementId: string }) {
  const [state, setState] = useDashboardState<Awaited<ReturnType<ProductApiClient["getBrandAgreementDetail"]>>>();
  const load = useCallback(() =>
    role === "brand"
      ? new ProductApiClient().getBrandAgreementDetail(agreementId)
      : new ProductApiClient().getCreatorAgreementDetail(agreementId), [agreementId, role]);

  useEffect(() => {
    void loadDashboard(load, setState);
  }, [load, setState]);

  return (
    <WorkspaceShell role={role} active="result" title="Agreement Detail" session={null}>
      <DashboardStatus state={state} retry={() => loadDashboard(load, setState)}>
        {(detail) => (
          <div className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
            <Panel>
              <SectionTitle eyebrow="Agreement" title={String(detail.agreement.agreementId)} />
              <div className="mt-4 grid gap-3">
                <InfoBox label="Status" value={String(detail.agreement.status)} />
                <InfoBox label="Promotion ID" value={String(detail.agreement.promotionId)} />
                <InfoBox label="termsHash" value={String(detail.agreement.termsHash ?? "not-created")} />
                <InfoBox label="Final amount" value={`${detail.agreement.terms.compensation.baseAmountUsdc} USDC`} />
                <InfoBox label="Deliverables" value={detail.agreement.terms.deliverables.map((item) => `${item.count} ${item.format}`).join(", ")} />
                <InfoBox label="Usage rights" value={detail.agreement.terms.usageRights} />
              </div>
              {detail.agreement.negotiationId ? (
                <div className="mt-5">
                  <PrimaryLink
                    href={
                      role === "brand"
                        ? `/brand/negotiations/${detail.agreement.negotiationId}`
                        : `/creator/offers/${detail.agreement.negotiationId}`
                    }
                  >
                    에스크로/정산 화면 열기
                  </PrimaryLink>
                </div>
              ) : null}
            </Panel>
            <Panel>
              <SectionTitle eyebrow="예치금" title="예치 상태" />
              {detail.escrow ? (
                <div className="mt-4 grid gap-3">
                  {role === "brand" ? (
                    <>
                      <InfoBox label="lockedAmount" value={`${calculateBrandEscrow(detail.escrow).lockedAmount} USDC`} />
                      <InfoBox label="releasedAmount" value={`${calculateBrandEscrow(detail.escrow).releasedAmount} USDC`} />
                      <InfoBox label="releasableAmount" value={`${calculateBrandEscrow(detail.escrow).releasableAmount} USDC`} />
                    </>
                  ) : (
                    <>
                      <InfoBox label="availableToClaimAmount" value={`${calculateCreatorSettlement(agreementMilestones(detail.agreement)).availableToClaimAmount} USDC`} />
                      <InfoBox label="paidAmount" value={`${calculateCreatorSettlement(agreementMilestones(detail.agreement)).paidAmount} USDC`} />
                      <InfoBox label="pendingAmount" value={`${calculateCreatorSettlement(agreementMilestones(detail.agreement)).pendingAmount} USDC`} />
                    </>
                  )}
                  <InfoBox label="Escrow ID" value={detail.escrow.escrowId} />
                  <InfoBox label="Status" value={detail.escrow.status} />
                  <InfoBox label="Signature" value={detail.escrow.lockSignature ?? "pending"} />
                </div>
              ) : (
                <EmptyState text="아직 escrow가 없습니다. Phase 5에서 실제 devnet lock/release가 연결됩니다." />
              )}
            </Panel>
            <Panel>
              <SectionTitle eyebrow="Milestones" title="마일스톤 진행률" />
              <div className="mt-4 space-y-3">
                {agreementMilestones(detail.agreement).map((milestone) => (
                  <div key={milestone.id} className="rounded border border-border-subtle bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold">{milestone.order}. {milestone.title}</div>
                        <p className="mt-1 text-sm text-muted">{milestone.condition}</p>
                      </div>
                      <span className="font-mono text-sm">{milestone.amountUsdc} USDC</span>
                    </div>
                    <div className="mt-3 font-mono text-xs uppercase text-muted">{milestone.status}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}
      </DashboardStatus>
    </WorkspaceShell>
  );
}

export function RoleSignupScreen({ role, session }: { role: Role; session?: RoleSession }) {
  const roleSession = session ?? fallbackRoleSession(role);
  const router = useRouter();
  const { refresh } = useAuth();
  const nextHref = role === "brand" ? "/brand" : "/creator/connect";
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const configured = firebaseConfigured();

  async function submit(formData: FormData) {
    setStatus("saving");
    setError(null);
    try {
      if (!configured) throw new Error(authConfigurationError());
      const displayName = String(formData.get("name") ?? roleSession.userLabel);
      const email = String(formData.get("email") ?? "");
      const password = String(formData.get("password") ?? "");
      await createFirebaseAccount(email, password, displayName);
      const api = new ProductApiClient();
      await api.getMe();
      let account = await api.selectMyRole(
        role.toUpperCase() as "BRAND" | "CREATOR",
        uniqueRequestKey(`signup-role-${role}`),
      );
      if (role === "brand") {
        account = await api.createMyBrandProfile(
          {
            brandName: formString(formData, "workspace", displayName),
            websiteUrl: formHttpUrl(formData, "websiteUrl", ""),
            categories: splitList(formString(formData, "categories", "")),
            targetAudience: "프로모션별로 설정",
            description: "프로모션 생성 시 제품과 캠페인 조건을 입력합니다.",
            restrictedClaims: [],
          },
          uniqueRequestKey("signup-brand-profile"),
        );
      }
      saveCurrentAccount(account);
      await refresh();
      router.replace(nextHref);
    } catch (caught) {
      setError(firebaseAuthErrorMessage(caught));
      setStatus("idle");
    }
  }

  return (
    <AuthFrame
      eyebrow={`${role} signup`}
      title={`${roleSession.organizationLabel} 프로필 생성`}
      body="계정을 만들고 선택한 역할에 맞는 프로필을 연결합니다."
    >
      <Panel>
        <form action={submit}>
          <div className="flex items-center gap-4">
            <AgentCharacter agentId={roleSession.agentId} side={role} category="wellness" pose="greet" size={82} />
            <div>
              <Pill>{roleSession.agentLabel}</Pill>
              <h2 className="mt-2 text-3xl font-semibold">기본 계정 정보</h2>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Input label="Name" name="name" placeholder={roleSession.userLabel} required />
            <Input label={role === "brand" ? "Brand name" : "Creator name"} name="workspace" placeholder={roleSession.organizationLabel} required />
            <Input label="Email" name="email" placeholder="you@knot.demo" type="email" required />
            <Input label="Password" name="password" placeholder="Password, 6+ characters" type="password" minLength={6} required />
            {role === "brand" ? (
              <>
                <Input label="Brand website URL" name="websiteUrl" placeholder="https://yourbrand.com" required />
                <Input label="Brand categories" name="categories" placeholder="beauty, food, tech" required />
              </>
            ) : (
              <Input label="Workspace handle" name="handle" placeholder="creator-studio" />
            )}
          </div>
          {!configured && <FormError message={authConfigurationError()} />}
          {error && <FormError message={error} />}
          <div className="mt-6">
            <button
              type="submit"
              disabled={status === "saving" || !configured}
              className="inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {status === "saving" ? "저장 중..." : role === "brand" ? "대시보드로 이동" : "온보딩 계속"}
            </button>
          </div>
        </form>
      </Panel>
    </AuthFrame>
  );
}

export function BrandOnboardingScreen() {
  const router = useRouter();
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setStatus("saving");
    setError(null);
    try {
      const response = await new ProductApiClient().createMyBrandProfile({
        brandName: formString(formData, "brandName", "Brand"),
        websiteUrl: formHttpUrl(formData, "websiteUrl", ""),
        categories: splitList(formString(formData, "categories", "")),
        customCategory: formString(formData, "customCategory", ""),
        targetAudience: formString(formData, "targetAudience", ""),
        description: formString(formData, "description", ""),
        restrictedClaims: splitList(formString(formData, "restrictedClaims", "")),
      }, `brand-profile-${Date.now()}`);
      saveCurrentAccount(response);
      saveLocalSession({
        role: "brand",
        brandId: String(response.brand.brandId ?? ""),
        brandAgentId: String(response.agent.agentId ?? ""),
      });
      router.push("/brand");
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("idle");
    }
  }

  return (
    <WorkspaceShell role="brand" active="onboarding" title="브랜드 온보딩" session={null}>
      <div className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
        <Panel>
          <form action={submit}>
            <SectionTitle eyebrow="Brand profile" title="안정적인 브랜드 정보만 저장합니다" />
            <Input label="Brand name" name="brandName" placeholder="Brand name" required />
            <Input label="Brand website URL" name="websiteUrl" placeholder="https://yourbrand.com" required />
            <ChoiceGroup
              label="Categories"
              name="categories"
              options={["beauty", "fashion", "food", "tech", "fitness", "home", "travel"]}
              defaultSelected={["beauty"]}
            />
            <Input label="Custom category" name="customCategory" placeholder="clean skincare" />
            <TextArea label="Primary target audience" name="targetAudience" placeholder="예: 25-34, clean beauty에 관심 있는 직장인" />
            <TextArea label="Description" name="description" placeholder="브랜드 톤, 가치, 고객에게 주는 핵심 경험" />
            <TextArea label="Restricted claims" name="restrictedClaims" placeholder="의료 효능 과장, 무검수 게시 등" />
            {error && <FormError message={error} />}
            <button
              type="submit"
              disabled={status === "saving"}
              className="mt-5 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-background disabled:opacity-60"
            >
              {status === "saving" ? "저장 중..." : "Brand profile 저장"}
            </button>
          </form>
        </Panel>
        <Panel>
          <SectionTitle eyebrow="Scope" title="Promotion 정보는 다음 단계에서 입력합니다" />
          <div className="space-y-3">
            <InfoBox label="이 페이지에 저장" value="브랜드명, 웹사이트, 카테고리, 타겟, 제한 표현" />
            <InfoBox label="여기서 제외" value="제품명, 예산, deliverables, usage rights, deadline" />
            <InfoBox label="저장 위치" value="계정에 브랜드 프로필과 에이전트를 연결" />
          </div>
        </Panel>
      </div>
    </WorkspaceShell>
  );
}

export function BrandProductScreen({ product }: { product: BrandProduct }) {
  const router = useRouter();
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setStatus("saving");
    setError(null);
    try {
      const session = readLocalSession();
      const promotion = await new ProductApiClient().createPromotion({
        promotionId: undefined,
        brandId: session.brandId || "brand-001",
        brandAgentId: session.brandAgentId || "brand-agent-001",
        title: formString(formData, "productName", product.title),
        objective: formString(formData, "objective", "awareness"),
        category: formString(formData, "category", product.category),
        targetAudience: splitList(formString(formData, "targetAudience", product.targetAudience)),
        budget: {
          totalUsdc: numberFromForm(formData, "totalBudget", product.budgetUsdc),
          maxPerCreatorUsdc: numberFromForm(formData, "maxOffer", product.maxOfferUsdc),
        },
        deliverables: [{ format: "reel", count: 1 }],
        postingWindow: { start: "2026-08-05", end: "2026-08-10" },
        usageRights: formString(formData, "usageRights", "paidBoost30d"),
        constraints: {
          requiredDisclosures: ["ad"],
          prohibitedClaims: splitList(formString(formData, "blockedTerms", "")),
          requiredCategories: [formString(formData, "category", product.category)],
        },
        autonomy: { maxNegotiationRounds: 5, autoEscrow: true, autoRelease: true },
      });
      saveLocalSession({ ...session, role: "brand", promotionId: promotion.promotionId });
      router.push(`/brand/negotiate?promotionId=${promotion.promotionId}`);
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("idle");
    }
  }

  return (
    <WorkspaceShell role="brand" active="product" title="제품 추가" session={null}>
      <div className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
        <Panel>
          <form action={submit}>
            <SectionTitle eyebrow="Promotion input" title="협찬할 제품 내용을 추가합니다" />
            <Input label="Product document" name="documentHint" placeholder="PDF 또는 제품 설명 파일 업로드 예정" />
            <Input label="Product name" name="productName" placeholder={product.title} required />
            <Input label="Product URL" name="productUrl" placeholder="https://brand.example/summer-kit" />
            <Input label="Category" name="category" placeholder={product.category} required />
            <TextArea label="Target audience" name="targetAudience" placeholder={product.targetAudience} />
            <TextArea label="Objective" name="objective" placeholder="여름 스킨케어 루틴 인지도와 스토리 링크 전환" />
            <TextArea label="Deliverables" name="deliverables" placeholder={product.deliverables.join(", ")} />
            <label className="block text-sm font-semibold">
              Usage rights
              <select
                name="usageRights"
                className="mt-2 w-full rounded border border-border-subtle bg-background p-3 text-sm outline-none focus:border-accent"
                defaultValue="paidBoost30d"
              >
                <option value="paidBoost30d">Paid boost up to 30 days</option>
                <option value="organicOnly">Organic usage only</option>
              </select>
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="Total budget (USDC)" name="totalBudget" placeholder={String(product.budgetUsdc)} type="number" required />
              <Input label="Maximum offer (USDC)" name="maxOffer" placeholder={String(product.maxOfferUsdc)} type="number" required />
            </div>
            <ChoiceGroup name="blockedTerms" label="제외 조건" options={["무기한 사용권", "과장 효능 표현", "무검수 게시", "가격 미공개"]} defaultSelected={product.blockedTerms} />
            {error && <FormError message={error} />}
            <button
              type="submit"
              disabled={status === "saving"}
              className="mt-6 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-background disabled:opacity-60"
            >
              {status === "saving" ? "저장 중..." : "Promotion 저장하고 Agent 실행 화면으로 이동"}
            </button>
          </form>
        </Panel>
        <Panel>
          <SectionTitle eyebrow="협상 조건" title="에이전트가 사용할 공개 조건" />
          <div className="space-y-3">
            <InfoBox label="Product" value={product.title} />
            <InfoBox label="Target audience" value={product.targetAudience} />
            <InfoBox label="Max public offer" value={`${product.maxOfferUsdc} USDC`} />
          </div>
          <PrivacyNote>
            내부 한도와 승인 기준은 상대에게 공개하지 않습니다. 공개 가능한 제안 조건만 협상에 사용합니다.
          </PrivacyNote>
        </Panel>
      </div>
    </WorkspaceShell>
  );
}

export function BrandNegotiationScreen({ view, product }: { view: NegotiationView; product: BrandProduct }) {
  return (
    <WorkspaceShell role="brand" active="negotiation" title="크리에이터 매칭 · 협상" session={null}>
      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <Panel>
          <SectionTitle eyebrow="Matching" title="Creator 후보" />
          <div className="mt-4 grid gap-3">
            {view.candidates.length ? (
              view.candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.creatorAgentId}
                  name={candidate.displayName}
                  score={candidate.score === null ? "-" : String(candidate.score)}
                  reason={candidate.reason}
                  selected={candidate.selected}
                  eligible={candidate.eligible}
                />
              ))
            ) : (
              <EmptyState text="아직 후보 탐색을 시작하지 않았습니다. 에이전트를 실행하면 협상 가능한 후보를 찾습니다." />
            )}
          </div>
        </Panel>
        <AgentNegotiationPanel view={view} promotionId={product.productId} />
      </div>
      <Panel>
        <SectionTitle eyebrow="Promotion" title={product.title} />
        <div className="grid gap-3 md:grid-cols-4">
          <InfoBox label="Budget" value={`${product.budgetUsdc} USDC`} />
          <InfoBox label="Max offer" value={`${product.maxOfferUsdc} USDC`} />
          <InfoBox label="Status" value={product.status} />
          <InfoBox label="협상 기록" value={view.taskId} />
        </div>
      </Panel>
    </WorkspaceShell>
  );
}

export function BrandResultScreen({ view }: { view: NegotiationView }) {
  return (
    <WorkspaceShell role="brand" active="result" title="협상 결과" session={null}>
      <AgreementPanel view={view} />
      <div className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
        <Panel>
          <SectionTitle eyebrow="Result" title={view.agreementId ? `${view.counterpartyLabel}와 합의됐습니다` : "아직 계약이 없습니다"} />
          <p className="text-muted">
            {view.agreementId
              ? "양쪽 에이전트가 협상을 마쳤고, 공개 가능한 합의 조건만 계약에 저장했습니다."
              : "먼저 협상 화면에서 에이전트를 실행해야 계약이 생성됩니다."}
          </p>
        </Panel>
        <Panel>
          <SectionTitle eyebrow="Next" title="정산 준비" />
          <p className="text-muted">
            실제 지급은 검증 기준을 통과한 뒤 계약 예치금에서 진행됩니다.
          </p>
          <div className="mt-5">
            {view.agreementId ? (
              <PrimaryLink href={`/brand/settlement?agreementId=${view.agreementId}`}>정산 페이지로 이동</PrimaryLink>
            ) : (
              <SecondaryLink href={`/brand/negotiate?promotionId=${view.promotionId}`}>협상 화면으로 돌아가기</SecondaryLink>
            )}
          </div>
        </Panel>
      </div>
    </WorkspaceShell>
  );
}

export function BrandSettlementScreen({
  settlement,
  milestones,
  agreementId,
}: {
  settlement: Settlement;
  milestones: Milestone[];
  agreementId: string;
}) {
  return (
    <WorkspaceShell role="brand" active="settlement" title="정산" session={null}>
      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <SettlementPanel settlement={settlement} />
        <div className="grid gap-5">
          <MilestonePanel milestones={milestones} mode="brand" />
          <SettlementActionPanel
            agreementId={agreementId}
            milestoneId={milestones.find((milestone) => milestone.id === "content")?.id ?? milestones[0]?.id}
            alreadyReleased={Boolean(settlement.releaseTx) || settlement.escrowStatus === "RELEASED"}
          />
        </div>
      </div>
    </WorkspaceShell>
  );
}

export function BrandSettlementEmptyScreen({ message }: { message: string }) {
  return (
    <WorkspaceShell role="brand" active="settlement" title="정산" session={null}>
      <Panel>
        <SectionTitle eyebrow="Settlement" title="아직 정산할 Agreement가 없습니다" />
        <p className="text-muted">{message}</p>
        <div className="mt-5">
          <SecondaryLink href="/brand/negotiate">협상 화면으로 이동</SecondaryLink>
        </div>
      </Panel>
    </WorkspaceShell>
  );
}

export function CreatorOnboardingScreen() {
  const router = useRouter();
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setStatus("saving");
    setError(null);
    try {
      const response = await new ProductApiClient().createMyCreatorProfile({
        creatorName: formString(formData, "creatorName", "Creator"),
        snsUrl: formHttpUrl(formData, "snsUrl", "https://instagram.com/creator"),
        categories: splitList(formString(formData, "categories", "")),
        customCategory: formString(formData, "customCategory", ""),
        minimumUsdc: numberFromForm(formData, "minimumUsdc", 300),
        blockedDomains: splitList(formString(formData, "blockedDomains", "")),
        preferredContent: splitList(formString(formData, "preferredContent", "")),
        walletAddress: formString(formData, "walletAddress", ""),
      }, `creator-profile-${Date.now()}`);
      saveCurrentAccount(response);
      saveLocalSession({
        role: "creator",
        creatorId: response.creator.creatorId,
        creatorAgentId: response.creator.creatorAgentId,
      });
      router.push("/creator");
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("idle");
    }
  }

  return (
    <WorkspaceShell role="creator" active="onboarding" title="크리에이터 온보딩" session={null}>
      <div className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
        <Panel>
          <form action={submit}>
            <SectionTitle eyebrow="Creator profile" title="프로필과 기본 Agent 기준을 저장합니다" />
            <Input label="Creator display name" name="creatorName" placeholder="Creator name" required />
            <Input label="Instagram / TikTok / YouTube URL" name="snsUrl" placeholder="https://instagram.com/creator" required />
            <ChoiceGroup
              label="Categories"
              name="categories"
              options={["beauty", "fashion", "food", "tech", "fitness", "home", "travel"]}
              defaultSelected={["beauty"]}
            />
            <Input label="Custom category" name="customCategory" placeholder="vegan lifestyle" />
            <Input label="Minimum sponsorship amount" name="minimumUsdc" placeholder="500" type="number" required />
            <ChoiceGroup
              label="Preferred content"
              name="preferredContent"
              options={["Instagram Reels", "TikTok short", "Story link", "YouTube Shorts", "UGC review"]}
              defaultSelected={["Instagram Reels"]}
            />
            <ChoiceGroup
              label="Blocked domains"
              name="blockedDomains"
              options={["담배", "도박", "성인", "고위험 투자", "의료 효능 과장", "정치"]}
              defaultSelected={["담배", "도박"]}
            />
            <Input label="Settlement wallet public address" name="walletAddress" placeholder="Optional" />
            {error && <FormError message={error} />}
            <button
              type="submit"
              disabled={status === "saving"}
              className="mt-5 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-background disabled:opacity-60"
            >
              {status === "saving" ? "저장 중..." : "Creator profile 저장"}
            </button>
          </form>
        </Panel>
        <Panel>
          <SectionTitle eyebrow="Private criteria" title="브랜드에게 공개되지 않는 기준입니다" />
          <div className="space-y-3">
            <InfoBox label="공개 프로필" value="이름, SNS reference, 카테고리, 공개 rate band" />
            <InfoBox label="비공개 Agent 기준" value="minimum, blocked domains, preferred content" />
            <InfoBox label="주의" value="SNS 분석은 ingestion이 연결된 뒤에만 표시합니다" />
          </div>
        </Panel>
      </div>
    </WorkspaceShell>
  );
}

export function CreatorCriteriaScreen({ criteria }: { criteria: CreatorCriteria }) {
  const router = useRouter();
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setStatus("saving");
    setError(null);
    try {
      const session = readLocalSession();
      const creatorId = session.creatorId || "creator-001";
      await new ProductApiClient().updateCreatorCriteria(creatorId, {
        minimumUsdc: numberFromForm(formData, "minimumUsdc", criteria.minimumUsdc),
        blockedDomains: splitList(formString(formData, "blockedDomains", "")),
        preferredContent: splitList(formString(formData, "preferredContent", "")),
        usageRights: formString(formData, "usageRights", criteria.usageRights),
        notes: formString(formData, "notes", criteria.notes),
      });
      router.push("/creator/result");
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("idle");
    }
  }

  return (
    <WorkspaceShell role="creator" active="criteria" title="협상 기준 추가" session={null}>
      <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
        <Panel>
          <form action={submit}>
            <SectionTitle eyebrow="Private criteria" title="Agent가 지킬 기준을 정합니다" />
            <Input label="Minimum amount (USDC)" name="minimumUsdc" placeholder={String(criteria.minimumUsdc)} type="number" required />
            <ChoiceGroup
              name="blockedDomains"
              label="받지 않을 주제"
              options={["담배", "도박", "고위험 금융", "의료 효능 과장", "정치 광고", "성인 콘텐츠", "환경오염 논란"]}
              defaultSelected={criteria.blockedDomains}
            />
            <ChoiceGroup
              name="preferredContent"
              label="선호 콘텐츠"
              options={["Instagram Reels", "제품 리뷰", "스토리 링크", "UGC 컷다운", "라이브 쇼핑", "롱폼 리뷰"]}
              defaultSelected={criteria.preferredContent}
            />
            <label className="mt-4 block">
              <span className="text-sm font-semibold">Usage rights</span>
              <select name="usageRights" className="mt-2 w-full rounded border border-border-subtle bg-background p-3 text-sm outline-none focus:border-accent" defaultValue={criteria.usageRights}>
                <option value="organicOnly">organicOnly</option>
                <option value="paidBoost30d">paidBoost30d</option>
                <option value="fullLicense90d">fullLicense90d</option>
              </select>
            </label>
            <TextArea label="기타 기준" name="notes" placeholder={criteria.notes} />
            {error && <FormError message={error} />}
            <button
              type="submit"
              disabled={status === "saving"}
              className="mt-6 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-background disabled:opacity-60"
            >
              {status === "saving" ? "저장 중..." : "Agent 기준 저장하고 결과 보기"}
            </button>
          </form>
        </Panel>
        <Panel>
          <SectionTitle eyebrow="Privacy boundary" title="비공개 기준은 노출하지 않습니다" />
          <p className="text-muted">
            Minimum, blocked domains, 개인 pricing preference는 Creator Agent 내부 판단에만 사용됩니다. Brand 화면에는 수락, counter, 거절 결과와 공개 가능한 이유만 표시됩니다.
          </p>
          <div className="mt-5 space-y-3">
            <InfoBox label="Usage rights" value={criteria.usageRights} />
            <InfoBox label="Agent action" value="Offer filter, counter, reject" />
          </div>
        </Panel>
      </div>
    </WorkspaceShell>
  );
}

export function CreatorResultScreen({ deals }: { deals: CreatorDeal[] }) {
  return (
    <WorkspaceShell role="creator" active="result" title="협상 결과" session={null}>
      <div className="grid gap-5 lg:grid-cols-[0.75fr_1.25fr]">
        <Panel>
          <SectionTitle eyebrow="Agent summary" title="Creator Agent가 처리한 제안" />
          <p className="text-muted">
            각 브랜드와의 협상 결과만 보여줍니다. 브랜드의 내부 최대가와 평가 기준은 공개하지 않습니다.
          </p>
          <div className="mt-5 grid gap-3">
            <InfoBox label="Negotiated" value={String(deals.length)} />
            <InfoBox label="Agreed" value={String(deals.filter((deal) => deal.status === "AGREED").length)} />
            <InfoBox label="Rejected by policy" value={String(deals.filter((deal) => deal.status === "REJECTED").length)} />
          </div>
        </Panel>
        <div className="grid gap-4">
          {deals.length ? (
            deals.map((deal) => (
              <CreatorDealCard key={deal.brandId} deal={deal} />
            ))
          ) : (
            <Panel>
              <SectionTitle eyebrow="Empty" title="아직 처리된 제안이 없습니다" />
              <p className="text-muted">
                Brand Agent가 Promotion을 만들고 Run Agent를 실행하면 Creator Agent가 처리한 결과가 여기에 표시됩니다.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}

export function CreatorBrandDetailScreen({ deal }: { deal: CreatorDeal }) {
  return (
    <WorkspaceShell role="creator" active="result" title={deal.brandName} session={null}>
      <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
        <Panel>
          <SectionTitle eyebrow="Brand deal" title={deal.productTitle} />
          <div className="space-y-3">
            <InfoBox label="Status" value={deal.status} />
            <InfoBox label="Result" value={deal.visibleResult} />
            <InfoBox label="Amount" value={`${deal.amountUsdc} USDC`} />
            <InfoBox label="termsHash" value={deal.termsHash ?? "not created"} />
          </div>
        </Panel>
        {deal.status === "AGREED" ? (
          <MilestonePanel milestones={deal.milestones} mode="creator" />
        ) : (
          <Panel>
            <SectionTitle eyebrow="No milestone" title="아직 수행할 작업이 없습니다" />
            <p className="text-muted">
              합의된 브랜드만 마일스톤과 정산 상태를 표시합니다.
            </p>
          </Panel>
        )}
      </div>
      {deal.status === "AGREED" && <SettlementPanel settlement={deal.settlement} />}
    </WorkspaceShell>
  );
}

export function RoleMeScreen({ role, session }: { role: Role; session?: RoleSession }) {
  const roleSession = session ?? fallbackRoleSession(role);
  return (
    <WorkspaceShell role={role} active="me" title="마이페이지" session={roleSession}>
      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <Panel>
          <div className="flex items-center gap-4">
            <AgentCharacter agentId={roleSession.agentId} side={role} category="wellness" pose="idle" size={92} />
            <div>
              <Pill>{role}</Pill>
              <h2 className="mt-2 text-3xl font-semibold">{roleSession.organizationLabel}</h2>
            </div>
          </div>
        </Panel>
        <Panel>
          <SectionTitle eyebrow="Profile" title="프로필 요약" />
          <p className="text-muted">{roleSession.profileSummary}</p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <InfoBox label="User" value={roleSession.userLabel} />
            <InfoBox label="Wallet" value={roleSession.walletAddress} />
          </div>
        </Panel>
      </div>
    </WorkspaceShell>
  );
}

export function RoleSettingsScreen({ role, session }: { role: Role; session?: RoleSession }) {
  const roleSession = session ?? fallbackRoleSession(role);
  return (
    <WorkspaceShell role={role} active="settings" title="설정" session={roleSession}>
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel>
          <SectionTitle eyebrow="Account" title="계정" />
          <Input label="Display name" placeholder={roleSession.userLabel} />
          <Input label="Workspace" placeholder={roleSession.organizationLabel} />
        </Panel>
        <Panel>
          <SectionTitle eyebrow="Agent" title="에이전트" />
          <InfoBox label="Agent ID" value={roleSession.agentId} />
          <InfoBox label="Mode" value="ACTIVE" />
          <PrivacyNote>에이전트 설정 변경은 기록으로 남고, 결제는 정해진 승인 기준을 통과해야 합니다.</PrivacyNote>
        </Panel>
        <Panel>
          <SectionTitle eyebrow="Wallet" title="지갑" />
          <Input label="Wallet address" placeholder={roleSession.walletAddress} />
          <InfoBox label="네트워크" value="테스트 결제망" />
        </Panel>
      </div>
    </WorkspaceShell>
  );
}

export function DevAdminScreen({ overview }: { overview: DevOverview }) {
  return (
    <div className="flex flex-col gap-7 py-8">
      <PageTitle
        eyebrow="Dev admin"
        title="운영자용 상태 확인"
        body="시연 데이터와 실제 서비스 데이터의 연결 상태를 확인합니다."
      />
      <div className="grid gap-5 md:grid-cols-3">
        <InfoPanel label="데이터 상태" value={overview.dataMode} />
        <InfoPanel label="진행 중 협상" value={String(overview.activeTaskCount)} />
        <InfoPanel label="시연 데이터" value={String(overview.mockCollectionCount)} />
      </div>
      <Panel>
        <SectionTitle eyebrow="Routes" title="MVP app surface" />
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {[...brandWorkspaceRoutes, ...creatorWorkspaceRoutes].map((route) => (
            <Link key={route.href} href={route.href} className="rounded border border-border-subtle bg-background p-3 text-sm hover:bg-surface-raised">
              {route.href}
            </Link>
          ))}
        </div>
      </Panel>
      <Panel>
        <SectionTitle eyebrow="Events" title="System events" />
        <div className="mt-4 space-y-3">
          {overview.events.map((event) => (
            <div key={event.id} className="grid gap-3 rounded border border-border-subtle bg-background p-4 md:grid-cols-[80px_1fr_100px]">
              <span className="font-mono text-xs text-muted">{event.type}</span>
              <span>{event.label}</span>
              <span className="font-mono text-xs uppercase text-muted">{event.status}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

export function DevAdminLiveScreen() {
  const [overview, setOverview] = useState<ApiDevAdminOverview | null>(null);
  const [personas, setPersonas] = useState<ApiDevDemoPersonas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [switchingEmail, setSwitchingEmail] = useState<string | null>(null);
  const { refresh } = useAuth();
  const router = useRouter();

  async function load() {
    setStatus("loading");
    setError(null);
    try {
      const client = new ProductApiClient();
      const [nextOverview, nextPersonas] = await Promise.all([
        client.getDevAdminOverview(),
        client.getDevAdminDemoPersonas(),
      ]);
      setOverview(nextOverview);
      setPersonas(nextPersonas);
      setStatus("ready");
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }

  useEffect(() => {
    let active = true;
    async function loadInitial() {
      try {
        const client = new ProductApiClient();
        const [nextOverview, nextPersonas] = await Promise.all([
          client.getDevAdminOverview(),
          client.getDevAdminDemoPersonas(),
        ]);
        if (!active) return;
        setOverview(nextOverview);
        setPersonas(nextPersonas);
        setStatus("ready");
      } catch (caught) {
        if (!active) return;
        setError(errorMessage(caught));
        setStatus("error");
      }
    }
    void loadInitial();
    return () => {
      active = false;
    };
  }, []);

  async function loginAsPersona(
    persona: ApiDemoBrandPersona | ApiDemoCreatorPersona,
  ) {
    if (!persona.login.canLogin) return;
    setSwitchingEmail(persona.login.email);
    setError(null);
    try {
      await signInWithEmail(persona.login.email, persona.login.passwordHint);
      await refresh();
      router.push(persona.kind === "BRAND" ? "/brand" : "/creator");
    } catch (caught) {
      setError(firebaseAuthErrorMessage(caught));
    } finally {
      setSwitchingEmail(null);
    }
  }

  return (
    <div className="flex flex-col gap-7 py-8">
      <PageTitle
        eyebrow="Dev admin"
        title="운영자용 상태 확인"
        body="운영 권한이 있는 계정만 서비스 상태를 확인할 수 있습니다."
      />
      {status === "loading" && <Panel>관리자 권한과 운영 데이터를 확인하는 중입니다.</Panel>}
      {status === "error" && (
        <Panel>
          <SectionTitle eyebrow="Access" title="접근할 수 없습니다" />
          <FormError message={error ?? "Dev admin request failed."} />
          <button
            type="button"
            onClick={load}
            className="mt-5 rounded-full border border-border-subtle px-4 py-2 text-sm font-semibold"
          >
            다시 시도
          </button>
        </Panel>
      )}
      {overview && (
        <>
          <div className="grid gap-5 md:grid-cols-3">
            <InfoPanel label="Admin API" value={overview.enabled ? "enabled" : "disabled"} />
            <InfoPanel label="Actor UID" value={overview.actorUid} />
            <InfoPanel label="Failures" value={String(overview.latestFailures.length)} />
          </div>
          <Panel>
            <SectionTitle eyebrow="Overview" title="Firestore counts" />
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {Object.entries(overview.counts).map(([key, value]) => (
                <InfoBox key={key} label={key} value={String(value)} />
              ))}
            </div>
          </Panel>
          {personas && (
            <Panel>
              <SectionTitle
                eyebrow="Demo personas"
                title="프로필 목록"
              />
              <p className="mt-2 text-sm text-muted">
                {personas.brandCount}개 브랜드, {personas.creatorCount}개 크리에이터를 한 번에
                확인합니다.
              </p>
              <div className="mt-5 grid gap-5 xl:grid-cols-2">
                <DemoPersonaColumn
                  title="브랜드"
                  items={personas.brands}
                  switchingEmail={switchingEmail}
                  onLogin={loginAsPersona}
                />
                <DemoPersonaColumn
                  title="크리에이터"
                  items={personas.creators}
                  switchingEmail={switchingEmail}
                  onLogin={loginAsPersona}
                />
              </div>
            </Panel>
          )}
          <Panel>
            <SectionTitle eyebrow="Tabs" title="Admin surface" />
            <div className="mt-4 grid gap-2 md:grid-cols-3">
              {["Overview", "Users", "Commerce", "Agents & A2A", "Escrow", "Audit"].map((tab) => (
                <div key={tab} className="rounded border border-border-subtle bg-background p-3 text-sm">
                  {tab}
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function DemoPersonaColumn({
  title,
  items,
  switchingEmail,
  onLogin,
}: {
  title: string;
  items: Array<ApiDemoBrandPersona | ApiDemoCreatorPersona>;
  switchingEmail: string | null;
  onLogin: (persona: ApiDemoBrandPersona | ApiDemoCreatorPersona) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">{title}</h3>
        <span className="font-mono text-xs text-muted">{items.length}</span>
      </div>
      <div className="grid gap-3">
        {items.map((item) => (
          <DemoPersonaRow
            key={`${item.kind}-${item.profileId}`}
            item={item}
            switchingEmail={switchingEmail}
            onLogin={onLogin}
          />
        ))}
      </div>
    </div>
  );
}

function DemoPersonaRow({
  item,
  switchingEmail,
  onLogin,
}: {
  item: ApiDemoBrandPersona | ApiDemoCreatorPersona;
  switchingEmail: string | null;
  onLogin: (persona: ApiDemoBrandPersona | ApiDemoCreatorPersona) => void;
}) {
  const metrics =
    item.kind === "CREATOR"
      ? [
          compactMetric("구독/팔로워", item.subscriberOrFollowerCount),
          compactMetric("평균 조회", item.averageRecentViews),
          compactMetric("중앙값", item.medianRecentViews),
        ].filter((metric): metric is string => Boolean(metric))
      : item.demoPermission
        ? ["허락 브랜드"]
        : ["공개 데이터"];
  const imageUrl = item.kind === "BRAND" ? item.logoUrl : item.profileImageUrl;
  const disabled = !item.login.canLogin || switchingEmail === item.login.email;
  return (
    <div className="rounded border border-border-subtle bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded border border-border-subtle bg-surface text-sm font-semibold">
            {imageUrl ? (
              <span
                aria-hidden="true"
                className="h-full w-full bg-cover bg-center"
                style={{ backgroundImage: `url(${imageUrl})` }}
              />
            ) : (
              item.displayName.slice(0, 2)
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-lg">{item.displayName}</strong>
              <span className="rounded-full border border-border-subtle px-2 py-0.5 text-xs text-muted">
                {item.kind === "BRAND" ? "Brand" : item.primaryPlatform ?? "Creator"}
              </span>
            </div>
            <p className="mt-1 break-all font-mono text-xs text-muted">{item.profileId}</p>
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onLogin(item)}
          className="rounded-full border border-border-subtle px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {switchingEmail === item.login.email ? "로그인 중" : "로그인"}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
        {item.categories.map((category) => (
          <span key={category} className="rounded-full bg-surface px-2 py-1">
            {category}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
        {item.platforms.map((platform) => (
          <span key={platform} className="rounded-full border border-border-subtle px-2 py-1">
            {platform}
          </span>
        ))}
        {metrics.map((metric) => (
          <span key={metric} className="rounded-full border border-border-subtle px-2 py-1">
            {metric}
          </span>
        ))}
      </div>
      <p className="mt-3 break-all font-mono text-xs text-muted">{item.login.email}</p>
      {!item.login.canLogin && (
        <p className="mt-2 text-xs text-red-600">Auth 계정 seed가 아직 필요합니다.</p>
      )}
    </div>
  );
}

function compactMetric(label: string, value: number | null | undefined) {
  if (typeof value !== "number") return null;
  return `${label} ${Intl.NumberFormat("ko-KR", { notation: "compact" }).format(value)}`;
}

function AuthFrame({ eyebrow, title, body, children }: { eyebrow: string; title: string; body: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-7 py-10">
      <PageTitle eyebrow={eyebrow} title={title} body={body} />
      {children}
    </div>
  );
}

function WorkspaceShell({
  role,
  title,
  session,
  children,
}: {
  role: Role;
  active: WorkspacePage;
  title: string;
  session: RoleSession | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 py-6">
      <header className="border-b border-border-subtle pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Pill>{role} workspace</Pill>
            <h1 className="mt-3 text-4xl font-semibold leading-none">{title}</h1>
            {session && <p className="mt-2 text-sm text-muted">{session.organizationLabel}</p>}
          </div>
          <nav aria-label={`${role} account actions`} className="flex flex-wrap gap-2 text-sm font-semibold">
            <Link href={`/${role}/me`} className="rounded-full border border-border-subtle bg-surface px-3 py-1.5 hover:bg-surface-raised">
              My
            </Link>
            <Link href={`/${role}/settings`} className="rounded-full border border-border-subtle bg-surface px-3 py-1.5 hover:bg-surface-raised">
              Settings
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex min-w-0 flex-col gap-5">{children}</main>
    </div>
  );
}

function RoleChoiceCard({ role, title, body, href }: { role: Role; title: string; body: string; href: string }) {
  return (
    <Panel>
      <div className="flex items-center gap-4">
        <AgentCharacter agentId={`${role}-signup-agent`} side={role} category="wellness" pose="greet" size={86} />
        <div>
          <Pill>{role}</Pill>
          <h2 className="mt-2 text-4xl font-semibold">{title}</h2>
        </div>
      </div>
      <p className="mt-4 text-muted">{body}</p>
      <div className="mt-6">
        <PrimaryLink href={href}>선택</PrimaryLink>
      </div>
    </Panel>
  );
}

function RoleJumpCard({ role, title, href }: { role: Role; title: string; href: string }) {
  return (
    <Link href={href} className="sketch ink block border border-border-subtle bg-surface p-5 hover:bg-surface-raised">
      <div className="flex items-center gap-3">
        <AgentCharacter agentId={`${role}-jump-agent`} side={role} category="wellness" pose="idle" size={64} />
        <div>
          <Pill>workspace</Pill>
          <h2 className="mt-1 text-2xl font-semibold">{title}</h2>
        </div>
      </div>
    </Link>
  );
}

function AgentRelayScene() {
  return (
    <div className="relative min-h-[390px] overflow-hidden rounded border border-border-subtle bg-background">
      <div className="absolute left-6 top-6">
        <div className="font-mono text-xs uppercase text-muted">A2A task stream</div>
        <div className="mt-1 text-3xl font-semibold">협상 진행중</div>
      </div>
      <div className="absolute left-[7%] top-[34%] text-center">
        <AgentCharacter agentId="creator-relay-agent" side="creator" category="wellness" pose="greet" size={116} />
        <div className="mt-2 text-sm font-semibold">Creator Agent</div>
      </div>
      <div className="absolute right-[7%] top-[34%] text-center">
        <AgentCharacter agentId="brand-relay-agent" side="brand" category="wellness" pose="greet" size={116} />
        <div className="mt-2 text-sm font-semibold">Brand Agent</div>
      </div>
      <div className="absolute left-1/2 top-[48%] h-2 w-40 -translate-x-1/2 overflow-hidden rounded-full border border-border-subtle bg-surface">
        <div className="h-full w-2/3 animate-pulse bg-accent" />
      </div>
      <div className="absolute bottom-6 left-6 right-6 grid gap-2 sm:grid-cols-3">
        <InfoBox label="A2A" value="working" />
        <InfoBox label="Visible" value="progress + result" />
        <InfoBox label="Private" value="policy hidden" />
      </div>
    </div>
  );
}

function AgentNegotiationPanel({ view, promotionId }: { view: NegotiationView; promotionId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "running">("idle");
  const [error, setError] = useState<string | null>(null);
  const progress = status === "running" ? 48 : view.progressPercent;

  async function runAgent() {
    setStatus("running");
    setError(null);
    try {
      const flow = await new ProductApiClient().runAgentForPromotion(promotionId);
      const agreementId = flow.agreement?.agreementId;
      if (!flow.negotiation) {
        setError("현재 조건에 맞는 Creator가 없어 대기 상태로 저장했습니다. 신규 Creator가 들어오면 다시 탐색할 수 있습니다.");
        setStatus("idle");
        router.refresh();
        return;
      }
      const params = new URLSearchParams({
        promotionId,
        negotiationId: flow.negotiation.negotiationId,
      });
      if (agreementId) {
        params.set("agreementId", agreementId);
      }
      router.push(`/brand/result?${params.toString()}`);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("idle");
    }
  }

  return (
    <Panel>
      <AgentProgressCard
        role={view.role}
        title={view.agreementId ? "협상이 완료됐습니다" : status === "running" ? "진행중이에요!" : "Agent 실행 대기"}
        body={
          view.agreementId
            ? `${view.counterpartyAgentLabel}와 협상 결과를 불러왔습니다.`
            : "에이전트를 실행하면 후보 탐색과 협상을 시작합니다."
        }
        progress={progress}
      />
      <div className="mt-6">
        <ProgressBar progress={progress} />
      </div>
      <div className="mt-5 grid gap-3">
        {view.tasks.map((task) => (
          <TaskRow key={task.id} task={task} forceDone={Boolean(view.agreementId)} />
        ))}
      </div>
      <div className="mt-5 grid gap-4">
        <CanonicalRunReplay events={view.runEvents} />
        <TechnicalProofPanel items={view.technicalProof} />
      </div>
      <PrivacyNote>
        사용자에게는 진행 상태와 최종 결과만 보여줍니다. 상대의 내부 한도와 평가 기준은 숨깁니다.
      </PrivacyNote>
      {error && <FormError message={error} />}
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={runAgent}
          disabled={status === "running" || Boolean(view.agreementId)}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-background"
        >
          {status === "running" ? "에이전트 실행 중..." : view.agreementId ? "계약 생성됨" : "에이전트 실행"}
        </button>
        {view.agreementId && <PrimaryLink href={`/brand/result?promotionId=${promotionId}&negotiationId=${view.negotiationId}&agreementId=${view.agreementId}`}>결과 확인</PrimaryLink>}
      </div>
    </Panel>
  );
}

function AgreementPanel({ view }: { view: NegotiationView }) {
  return (
    <Panel>
      <SectionTitle eyebrow="계약" title={view.title} />
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {view.terms.map((term) => (
          <InfoBox key={term.label} label={term.label} value={term.value} />
        ))}
      </div>
      <div className="mt-5 rounded border border-border-subtle bg-background p-4">
        <div className="font-mono text-xs uppercase text-muted">계약 증명</div>
        <div className="mt-1 break-all font-mono text-sm">{view.termsHash}</div>
      </div>
    </Panel>
  );
}

function SettlementPanel({ settlement }: { settlement: Settlement }) {
  return (
    <Panel>
      <SectionTitle eyebrow="예치금" title="크리에이터 보수 정산" />
      <div className="grid gap-3 md:grid-cols-2">
        <InfoBox label="예치 상태" value={settlement.escrowStatus} />
        <InfoBox label="예치 금액" value={`${settlement.escrowAmountUsdc} USDC`} />
        <InfoBox label="지급 완료" value={`${settlement.releasedUsdc} USDC`} />
        <InfoBox label="지급 대기" value={`${settlement.pendingUsdc} USDC`} />
      </div>
      <div className="mt-5 space-y-3">
        <TxBox label="예치 기록" value={settlement.lockTx} />
        <TxBox label="정산 기록" value={settlement.releaseTx} />
      </div>
      <PrivacyNote>
        외부 검증 비용과 크리에이터 보수 예치금은 분리되어 관리됩니다.
      </PrivacyNote>
    </Panel>
  );
}

function MilestonePanel({ milestones, mode }: { milestones: Milestone[]; mode: "brand" | "creator" }) {
  return (
    <Panel>
      <SectionTitle eyebrow="Milestones" title={mode === "brand" ? "검증 및 지급 단계" : "수행할 작업"} />
      <div className="mt-4 space-y-3">
        {milestones.map((milestone) => (
          <div key={milestone.id} className="rounded border border-border-subtle bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">{milestone.title}</div>
                <div className="mt-1 text-sm text-muted">{mode === "creator" ? milestone.creatorAction : milestone.status}</div>
              </div>
              <span className="font-mono text-sm">{milestone.amountUsdc} USDC</span>
            </div>
            <div className="mt-3">
              <ProgressBar progress={milestone.progressPercent} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function CandidateCard({
  name,
  score,
  reason,
  selected = false,
  eligible = true,
}: {
  name: string;
  score: string;
  reason: string;
  selected?: boolean;
  eligible?: boolean;
}) {
  return (
    <div className={`rounded border p-4 ${selected ? "border-positive bg-positive/10" : "border-border-subtle bg-background"}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">{name}</span>
        <span className="font-mono text-sm">score {score}</span>
      </div>
      <p className="mt-2 text-sm text-muted">{reason}</p>
      {!eligible && <div className="mt-3 text-sm font-semibold text-negative">Ineligible</div>}
      {selected && <div className="mt-3 text-sm font-semibold text-positive">A2A negotiation opened</div>}
    </div>
  );
}

function CreatorDealCard({ deal }: { deal: CreatorDeal }) {
  const href = deal.agreementId ? `/creator/agreements/${deal.agreementId}` : `/creator/result`;
  return (
    <Link href={href} className="sketch ink block border border-border-subtle bg-surface p-5 hover:bg-surface-raised">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Pill>{deal.status}</Pill>
          <h2 className="mt-2 text-3xl font-semibold">{deal.brandName}</h2>
          <p className="mt-1 text-muted">{deal.productTitle}</p>
        </div>
        <div className="font-mono text-xl">{deal.amountUsdc ? `${deal.amountUsdc} USDC` : "-"}</div>
      </div>
      <p className="mt-4 text-sm text-muted">{deal.visibleResult}</p>
    </Link>
  );
}

function SettlementActionPanel({
  agreementId,
  milestoneId,
  alreadyReleased,
}: {
  agreementId: string;
  milestoneId?: string;
  alreadyReleased: boolean;
}) {
  return (
    <Panel>
      <SectionTitle eyebrow="Action" title="정산 화면으로 이동" />
      <p className="text-sm text-muted">
        브랜드가 전체 금액을 예치하고, Creator가 URL을 제출하면 에이전트 검토 뒤 정산됩니다.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <PrimaryLink href={`/brand/agreements/${agreementId}`}>
          {alreadyReleased ? "정산 내역 보기" : "계약 상세로 이동"}
        </PrimaryLink>
        {!milestoneId ? <p className="text-sm text-muted">정산 가능한 milestone이 아직 없습니다.</p> : null}
      </div>
    </Panel>
  );
}

function AgentProgressCard({ role, title, body, progress }: { role: Role; title: string; body: string; progress: number }) {
  return (
    <div className="rounded border border-border-subtle bg-background p-5">
      <div className="flex items-center gap-5">
        <div className="relative">
          {progress < 100 && <div className="absolute -inset-4 animate-ping rounded-full border border-border-subtle opacity-40" />}
          <AgentCharacter agentId={`${role}-progress-agent`} side={role} category="wellness" pose={progress < 100 ? "walk" : "greet"} size={104} />
        </div>
        <div>
          <Pill>{progress < 100 ? "Working" : "Ready"}</Pill>
          <h2 className="mt-2 text-3xl font-semibold">{title}</h2>
          <p className="mt-2 text-sm text-muted">{body}</p>
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task, forceDone }: { task: AgentTask; forceDone: boolean }) {
  const status = forceDone && task.status !== "queued" ? "done" : task.status;
  return (
    <div className="rounded border border-border-subtle bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-semibold">{task.label}</span>
        <span className="font-mono text-xs uppercase text-muted">{status}</span>
      </div>
      <p className="mt-2 text-sm text-muted">{task.visibleDetail}</p>
    </div>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div>
      <div className="mb-2 flex justify-between font-mono text-xs text-muted">
        <span>progress</span>
        <span>{progress}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full border border-border-subtle bg-background">
        <div className="h-full bg-accent transition-all duration-700" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

type DashboardState<T> =
  | { type: "loading" }
  | { type: "ready"; data: T }
  | { type: "empty"; message: string }
  | { type: "forbidden"; message: string }
  | { type: "not-found"; message: string }
  | { type: "error"; message: string };

function useDashboardState<T>() {
  return useState<DashboardState<T>>({ type: "loading" });
}

async function loadDashboard<T>(
  loader: () => Promise<T>,
  setState: (state: DashboardState<T>) => void,
) {
  setState({ type: "loading" });
  try {
    const data = await loader();
    setState({ type: "ready", data });
  } catch (error) {
    if (error instanceof ProductApiError && error.status === 403) {
      setState({ type: "forbidden", message: error.message });
      return;
    }
    if (error instanceof ProductApiError && error.status === 404) {
      setState({ type: "not-found", message: error.message });
      return;
    }
    setState({ type: "error", message: errorMessage(error) });
  }
}

function DashboardStatus<T>({
  state,
  retry,
  children,
}: {
  state: DashboardState<T>;
  retry: () => void;
  children: (data: T) => ReactNode;
}) {
  if (state.type === "ready") return children(state.data);
  if (state.type === "loading") {
    return (
      <Panel>
        <SectionTitle eyebrow="Loading" title="데이터를 불러오는 중입니다" />
        <ProgressBar progress={64} />
      </Panel>
    );
  }
  if (state.type === "empty") {
    return (
      <Panel>
        <SectionTitle eyebrow="Empty" title="아직 표시할 데이터가 없습니다" />
        <EmptyState text={state.message} />
      </Panel>
    );
  }
  const title =
    state.type === "forbidden"
      ? "접근 권한이 없습니다"
      : state.type === "not-found"
        ? "데이터를 찾을 수 없습니다"
        : "다시 시도해주세요";
  return (
    <Panel>
      <SectionTitle eyebrow={state.type} title={title} />
      <p className="text-sm text-muted">{state.message}</p>
      {state.type === "error" && (
        <button
          type="button"
          onClick={retry}
          className="mt-5 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-background"
        >
          Retry
        </button>
      )}
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-border-subtle bg-surface p-4">
      <div className="text-xs font-semibold uppercase text-muted">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
    </div>
  );
}

function PromotionSummaryCard({
  promotion,
  productName,
  productCategory,
}: {
  promotion: BrandDashboard["activePromotions"][number];
  productName: string;
  productCategory: string;
}) {
  const progress = promotionProgress(promotion);
  const activeNegotiations = numberRecordValue(promotion, "activeNegotiationCount", 0);
  const agreedCreators = numberRecordValue(promotion, "agreedCreatorCount", 0);
  const deadline = promotion.postingWindow?.end ?? "deadline pending";
  return (
    <Link
      href={`/brand/promotions/${promotion.promotionId}`}
      className="grid gap-4 rounded border border-border-subtle bg-background p-4 hover:bg-surface-raised md:grid-cols-[72px_1fr]"
    >
      <div className="flex aspect-square items-center justify-center rounded border border-border-subtle bg-surface font-mono text-xs text-muted">
        IMG
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">{promotion.title}</h3>
            <p className="mt-1 text-sm text-muted">{productName} · {productCategory}</p>
          </div>
          <span className="font-mono text-xs uppercase text-muted">{promotion.status}</span>
        </div>
        <div className="mt-4 grid gap-2 text-sm md:grid-cols-4">
          <InfoBox label="총예산" value={`${promotion.budget.totalUsdc} USDC`} />
          <InfoBox label="마감일" value={deadline} />
          <InfoBox label="협상" value={String(activeNegotiations)} />
          <InfoBox label="체결" value={String(agreedCreators)} />
        </div>
        <div className="mt-4">
          <ProgressBar progress={progress} />
        </div>
      </div>
    </Link>
  );
}

function DeletePromotionButton({
  promotionId,
  onDeleted,
}: {
  promotionId: string;
  onDeleted: () => void;
}) {
  const action = useMutationLock();
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (action.status === "submitting") return;
    if (!window.confirm("이 프로모션을 삭제하면 복구할 수 없습니다.")) return;
    await action.run(async () => {
      setError(null);
      await new ProductApiClient().deleteBrandPromotion(promotionId, action.idempotencyKey);
      onDeleted();
    }, (caught) => setError(errorMessage(caught)));
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1">
      <p className="text-xs text-muted">계약 또는 정산 기록이 있으면 삭제할 수 없습니다.</p>
      <button
        type="button"
        onClick={remove}
        disabled={action.status === "submitting"}
        className="rounded-full border border-border-subtle bg-background px-3 py-1.5 text-xs font-semibold text-muted disabled:opacity-60"
      >
        {action.status === "submitting" ? "삭제 중..." : "삭제"}
      </button>
      {error && <div className="w-full text-xs text-red-700">{error}</div>}
    </div>
  );
}

function DashboardRow({ title, meta, href }: { title: string; meta: string; href?: string }) {
  const content = (
    <div className="rounded border border-border-subtle bg-background p-4 hover:bg-surface-raised">
      <div className="font-semibold">{title}</div>
      <div className="mt-1 text-sm text-muted">{meta}</div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function ChoiceGroup({
  label,
  name,
  options,
  defaultSelected = [],
}: {
  label: string;
  name?: string;
  options: string[];
  defaultSelected?: string[];
}) {
  const initialSelected = Array.isArray(defaultSelected) ? defaultSelected : [];
  const [selected, setSelected] = useState(initialSelected);
  const selectedText = useMemo(() => selected.join(", "), [selected]);
  return (
    <div className="mt-5">
      <div className="text-sm font-semibold">{label}</div>
      {name && <input type="hidden" name={name} value={selectedText} />}
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() =>
                setSelected((values) =>
                  active ? values.filter((value) => value !== option) : [...values, option],
                )
              }
              className={`rounded-full border px-3 py-1.5 text-sm ${
                active
                  ? "border-accent bg-accent text-background"
                  : "border-border-subtle bg-background text-foreground"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
      <div className="mt-2 font-mono text-xs text-muted">selected: {selectedText || "none"}</div>
    </div>
  );
}

function baseUnitsToUsdc(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  return (amount / 1_000_000).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

type DashboardSettlementSummary = {
  paidAmount: number;
  availableToClaimAmount: number;
  pendingAmount: number;
};

function creatorDashboardSettlement(agreements: Array<Record<string, unknown>>): DashboardSettlementSummary {
  return agreements.reduce<DashboardSettlementSummary>(
    (totals, agreement) => {
      const settlement = calculateCreatorSettlement(agreementMilestones(agreement as ApiAgreement & Record<string, unknown>));
      return {
        paidAmount: totals.paidAmount + settlement.paidAmount,
        availableToClaimAmount: totals.availableToClaimAmount + settlement.availableToClaimAmount,
        pendingAmount: totals.pendingAmount + settlement.pendingAmount,
      };
    },
    { paidAmount: 0, availableToClaimAmount: 0, pendingAmount: 0 },
  );
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function PageTitle({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div>
      <Pill>{eyebrow}</Pill>
      <h1 className="mt-3 text-5xl font-semibold leading-none">{title}</h1>
      <p className="mt-3 max-w-2xl text-muted">{body}</p>
    </div>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-4">
      <Pill>{eyebrow}</Pill>
      <h2 className="mt-3 text-3xl font-semibold leading-none">{title}</h2>
    </div>
  );
}

function Input({
  label,
  name,
  placeholder,
  type = "text",
  required = false,
  defaultValue,
  minLength,
}: {
  label: string;
  name?: string;
  placeholder: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
  minLength?: number;
}) {
  return (
    <label className="mt-4 block">
      <span className="text-sm font-semibold">{label}</span>
      <input
        type={type}
        name={name}
        required={required}
        defaultValue={defaultValue}
        minLength={minLength}
        className="mt-2 w-full rounded border border-border-subtle bg-background p-3 text-sm outline-none focus:border-accent"
        placeholder={placeholder}
      />
    </label>
  );
}

function TextArea({ label, name, placeholder, defaultValue }: { label: string; name?: string; placeholder: string; defaultValue?: string }) {
  return (
    <label className="mt-4 block">
      <span className="text-sm font-semibold">{label}</span>
      <textarea
        rows={4}
        name={name}
        defaultValue={defaultValue}
        className="mt-2 w-full rounded border border-border-subtle bg-background p-3 text-sm outline-none focus:border-accent"
        placeholder={placeholder}
      />
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded border border-border-subtle bg-background p-5 text-sm text-muted">{text}</div>;
}

function PrivacyNote({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 rounded border border-caution/40 bg-caution/10 p-3 text-sm text-muted">
      {children}
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded border border-negative/40 bg-negative/10 p-3 text-sm text-negative">
      {message}
    </div>
  );
}

function TxBox({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded border border-border-subtle bg-background p-3">
      <div className="font-mono text-[11px] uppercase text-muted">{label}</div>
      <div className="mt-1 break-all font-mono text-sm">{value ?? "pending live devnet transaction"}</div>
    </div>
  );
}

function InfoPanel({ label, value }: { label: string; value: string }) {
  return (
    <Panel>
      <div className="font-mono text-xs uppercase text-muted">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
    </Panel>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border-subtle bg-background p-3">
      <div className="font-mono text-[11px] uppercase text-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <section className="sketch ink border border-border-subtle bg-surface p-5">{children}</section>;
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="sketch-pill ink inline-flex border border-border-subtle bg-surface-raised px-3 py-1 font-mono text-xs uppercase text-muted">{children}</span>;
}

function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90">{children}</Link>;
}

function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="inline-flex rounded-full border border-border-subtle bg-surface px-5 py-2.5 text-sm font-semibold hover:bg-surface-raised">{children}</Link>;
}

function useMutationLock() {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const lockedRef = useRef(false);
  const reactId = useId();
  const idempotencyKey = useMemo(() => `frontend-${reactId.replace(/:/g, "")}`, [reactId]);

  const run = useCallback(
    async (action: () => Promise<void>, onError?: (caught: unknown) => void) => {
      if (lockedRef.current) return;
      lockedRef.current = true;
      setStatus("submitting");
      try {
        await action();
        setStatus("success");
      } catch (caught) {
        lockedRef.current = false;
        setStatus("error");
        onError?.(caught);
      }
    },
    [],
  );

  return { idempotencyKey, run, status };
}

type LocalSession = {
  userId?: string;
  role?: Role;
  brandId?: string;
  brandAgentId?: string;
  creatorId?: string;
  creatorAgentId?: string;
  promotionId?: string;
};

const LOCAL_SESSION_KEY = "knot.localSession";

function readLocalSession(): LocalSession {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(LOCAL_SESSION_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as LocalSession;
  } catch {
    return {};
  }
}

function saveLocalSession(next: LocalSession) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ ...readLocalSession(), ...next }));
}

function saveCurrentAccount(context: CurrentUserContext) {
  const account = context.account;
  saveLocalSession({
    userId: account.uid,
    role: account.role === "BRAND" ? "brand" : account.role === "CREATOR" ? "creator" : undefined,
    brandId: account.brandId ?? undefined,
    brandAgentId: account.role === "BRAND" ? account.agentId ?? undefined : undefined,
    creatorId: account.creatorId ?? undefined,
    creatorAgentId: account.role === "CREATOR" ? account.agentId ?? undefined : undefined,
  });
}

function fallbackForNegotiation(negotiation: ApiNegotiation) {
  return {
    negotiationId: negotiation.negotiationId,
    taskId: negotiation.taskId,
    contextId: negotiation.contextId,
    brandAgentId: negotiation.brandAgentId,
    creatorAgentId: negotiation.creatorAgentId,
    status: negotiation.status,
  };
}

function fallbackRoleSession(role: Role): RoleSession {
  const brand = role === "brand";
  return {
    role,
    userLabel: brand ? "Brand operator" : "Creator",
    organizationLabel: brand ? "Brand workspace" : "Creator workspace",
    agentId: `${role}-signup-agent`,
    agentLabel: brand ? "Brand Agent" : "Creator Agent",
    profileSummary: "Account context is created after Firebase sign-up.",
    walletAddress: "not-connected",
  };
}

function splitList(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formString(formData: FormData, key: string, fallback: string) {
  const value = formData.get(key);
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function defaultDeadlineDate() {
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 30);
  return deadline.toISOString().slice(0, 10);
}

function formHttpUrl(formData: FormData, key: string, fallback: string) {
  const value = formString(formData, key, fallback);
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return `https://${value}`;
}

function numberFromForm(formData: FormData, key: string, fallback: number) {
  const value = Number(formData.get(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function numberRecordValue(record: Record<string, unknown>, key: string, fallback: number) {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function errorMessage(caught: unknown) {
  if (caught instanceof Error) return caught.message;
  return String(caught);
}
