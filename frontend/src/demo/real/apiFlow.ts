"use client";

/**
 * 실시간 devnet 증빙 — 대본(engine/script.ts)과 완전히 별개로 진짜 백엔드를 호출한다.
 *
 * 흐름: 프로모션 생성 → agent-run(진짜 discovery+pay.sh verify+협상) → 브랜드 Phantom
 * 서명으로 에스크로 예치(devnet) → 크리에이터 게시물 URL 증빙 제출·검증 → evidence 통과 시
 * 서버(KNOT_SETTLEMENT_AUTHORITY)가 자동으로 devnet에 마일스톤 릴리즈를 서명·전송한다.
 *
 * 브랜드 예치는 gateway 모드에서 플랫폼이 대신 서명할 수 없다 — 반드시 브랜드 소유
 * Phantom 지갑의 실제 서명이 필요하다. 릴리즈는 플랫폼 정산 authority가 서버에서
 * 자동 서명하므로 크리에이터 쪽은 지갑 "주소 등록"(소유 증명 서명)만 필요하다.
 */

import { ProductApiClient, ProductApiError, type ApiAgreement } from "@/product/apiClient";
import {
  connectPhantomWallet,
  sendPreparedSolanaTransaction,
  signPhantomMessage,
  type PhantomWallet,
} from "@/features/wallet/phantom";
import { updateSession } from "@/demo/auth/session";
import type { BrandProfile, CampaignSpec } from "@/demo/engine/types";

const client = new ProductApiClient();

export function explorerUrl(signature: string, network = "devnet") {
  return `https://explorer.solana.com/tx/${signature}?cluster=${network}`;
}

/**
 * 지갑 소유 증명 후 계정에 등록 — 플랫폼이 키를 보관하지 않으므로(docs/17 D7) 이
 * 서명만이 주소 소유를 보증한다. 브랜드 예치·크리에이터 정산 등록 둘 다 이 과정이 필요하다.
 * KnotSession에도 반영해 잔액 UI 등 다른 화면이 같은 주소를 즉시 알 수 있게 한다.
 */
async function proveAndSaveWallet(wallet: PhantomWallet) {
  const { challenge } = await client.createWalletChallenge(wallet.address);
  const signature = await signPhantomMessage(challenge.message);
  await client.saveWalletAddress(wallet.address, {
    challengeId: challenge.challengeId,
    signature,
  });
  updateSession({ wallet: wallet.address });
}

/**
 * 이 데모용 Firebase 계정은 백엔드에 처음 보는 uid일 수 있다(예: 새로 배포된
 * knot-api가 데모 시드와 다른 Firebase 프로젝트를 쓸 때) — role/profile이 없으면
 * 먼저 최소 온보딩을 마쳐야 프로모션 생성·discovery가 작동한다.
 */
async function ensureBrandOnboarded(brand: BrandProfile) {
  const me = await client.getMe();
  if (me.account.role === "BRAND" && me.account.onboardingStatus === "COMPLETED") return;
  if (me.account.role !== "BRAND") {
    await client.selectMyRole("BRAND", `demo-role-brand-${Date.now()}`);
  }
  await client.createMyBrandProfile(
    {
      brandName: brand.name || "브랜드",
      websiteUrl: /^https?:\/\//.test(brand.url) ? brand.url : `https://${brand.url || "example.com"}`,
      // brand.tone is style adjectives (따뜻한/미니멀 등), not a business category —
      // keep this aligned with ensureCreatorOnboarded's categories so demo discovery
      // reliably finds a match regardless of what a real site scan returns.
      categories: ["lifestyle", "beauty", "food"],
      targetAudience: brand.audience || "20-34 관심 고객",
      description: brand.intro || brand.tagline || "",
      restrictedClaims: [],
    },
    `demo-brand-profile-${Date.now()}`,
  );
}

/**
 * 크리에이터도 마찬가지 — 게다가 discovery에 걸리려면 카테고리/최소가가 프로모션과
 * 맞아야 하니, 웬만한 브랜드 카테고리와 겹치도록 넉넉하게 잡는다.
 */
async function ensureCreatorOnboarded() {
  const me = await client.getMe();
  if (me.account.role === "CREATOR" && me.account.onboardingStatus === "COMPLETED") return;
  if (me.account.role !== "CREATOR") {
    await client.selectMyRole("CREATOR", `demo-role-creator-${Date.now()}`);
  }
  await client.createMyCreatorProfile(
    {
      creatorName: me.account.displayName || "데모 크리에이터",
      snsUrl: "https://instagram.com/knot.demo.creator",
      categories: ["lifestyle", "beauty", "food"],
      minimumUsdc: 10,
      blockedDomains: [],
      preferredContent: ["reel", "short", "post"],
    },
    `demo-creator-profile-${Date.now()}`,
  );
}

export async function createRealPromotionAndAgreement(brand: BrandProfile, spec: CampaignSpec) {
  await ensureBrandOnboarded(brand);
  const promotion = await client.createBrandPromotion(
    {
      productName: brand.name || "협찬 제품",
      title: `${brand.name || "브랜드"} × 크리에이터 협찬`,
      objective: spec.goal || "제품 인지도 확대",
      // brand.tone is style adjectives (따뜻한/미니멀 등), not a business category —
      // keep this aligned with ensureCreatorOnboarded's categories so demo discovery
      // reliably finds a match regardless of what a real site scan returns.
      categories: ["lifestyle", "beauty", "food"],
      targetAudience: brand.audience || "20-34 관심 고객",
      totalBudget: Math.max(spec.budgetUsdc, spec.maxPerDealUsdc),
      initialOffer: Math.max(1, Math.round(spec.maxPerDealUsdc * 0.7)),
      maximumPerCreator: spec.maxPerDealUsdc,
      autoAcceptCeiling: spec.maxPerDealUsdc,
      maximumRounds: 5,
      deliverables: [{ format: "reel", count: 1 }],
      usageRights: "paidBoost30d",
      // Backend expects a plain date (pydantic `date`), not a full ISO datetime.
      deadline: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString().slice(0, 10),
      prohibitedClaims: [],
    },
    `demo-promo-${Date.now()}`,
  );
  const run = await client.runAgentForPromotion(promotion.promotionId);
  return { promotionId: promotion.promotionId, run };
}

export async function fundRealEscrow(agreementId: string) {
  const wallet = await connectPhantomWallet();
  await proveAndSaveWallet(wallet);
  const prepared = await client.prepareEscrowFunding(
    agreementId,
    `demo-fund-${agreementId}-${wallet.address}`,
  );
  if (!prepared.funding) {
    // 이미 예치돼 있는 경우 등 — prepare가 재사용 가능한 상태를 그대로 돌려줬다.
    return { escrow: prepared.escrow, signature: null, brandWallet: wallet.address };
  }
  if (prepared.funding.brandAuthority !== wallet.address) {
    throw new Error(
      `연결된 Phantom 지갑(${shortAddr(wallet.address)})이 이 계약의 브랜드 예치 지갑` +
        `(${shortAddr(prepared.funding.brandAuthority)})과 달라요. 브랜드 지갑으로 다시 연결해 주세요.`,
    );
  }
  const signature = await sendPreparedSolanaTransaction(prepared.funding);
  const confirmed = await client.confirmEscrowFunding(
    agreementId,
    signature,
    `demo-confirm-${agreementId}-${signature}`,
  );
  return { escrow: confirmed.escrow, signature, brandWallet: wallet.address };
}

export async function registerCreatorWallet() {
  await ensureCreatorOnboarded();
  const wallet = await connectPhantomWallet();
  await proveAndSaveWallet(wallet);
  return wallet.address;
}

export async function submitRealEvidence(
  agreement: Pick<ApiAgreement, "agreementId" | "creatorAgentId">,
  milestoneId: string,
  url: string,
) {
  let evidenceId: string;
  try {
    const evidence = await client.submitEvidence(agreement, milestoneId, url);
    evidenceId = evidence.evidenceId;
  } catch (caught) {
    if (caught instanceof ProductApiError && caught.code === "EVIDENCE_ALREADY_SUBMITTED") {
      const detail = caught.detail as { evidence?: { evidenceId?: string } } | undefined;
      const existingId = detail?.evidence?.evidenceId;
      if (!existingId) throw caught;
      evidenceId = existingId;
    } else {
      throw caught;
    }
  }
  return client.verifyEvidence(evidenceId);
}

/** 아직 릴리즈 안 된 마일스톤 중 콘텐츠 증빙이 필요한 마지막 단계를 고른다. */
export function pickEvidenceMilestoneId(agreement: ApiAgreement): string | null {
  const milestones = agreement.terms.milestones;
  if (!milestones.length) return null;
  const contentMilestone = milestones.find((m) => m.trigger !== "AGREEMENT_SIGNED");
  return (contentMilestone ?? milestones[milestones.length - 1]).id;
}

function shortAddr(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
