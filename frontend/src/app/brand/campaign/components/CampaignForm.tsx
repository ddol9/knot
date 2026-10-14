"use client";

import type { CampaignRequest } from "@/product/campaignTypes";

/** 입력은 문자열로 들고, 제출 시에만 숫자로 바꾼다 (빈칸 = 서버 기본값). */
export type CampaignFormValues = {
  targetCreatorCount: string;
  maxCandidates: string;
  parallelism: string;
  openingAmountUsdc: string;
  ceilingUsdc: string;
  concessionPct: string;
  maxRounds: string;
};

export const defaultCampaignFormValues: CampaignFormValues = {
  targetCreatorCount: "2",
  maxCandidates: "5",
  parallelism: "3",
  openingAmountUsdc: "",
  ceilingUsdc: "",
  concessionPct: "50",
  maxRounds: "",
};

export function toCampaignRequest(values: CampaignFormValues): CampaignRequest {
  const number = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    targetCreatorCount: number(values.targetCreatorCount),
    maxCandidates: number(values.maxCandidates),
    parallelism: number(values.parallelism),
    openingAmountUsdc: number(values.openingAmountUsdc),
    ceilingUsdc: number(values.ceilingUsdc),
    concessionPct: number(values.concessionPct),
    maxRounds: number(values.maxRounds),
  };
}

export function validateCampaignForm(values: CampaignFormValues): string | null {
  const request = toCampaignRequest(values);
  if (!request.targetCreatorCount || request.targetCreatorCount < 1) return "목표 인원은 1명 이상이어야 합니다.";
  if (!request.maxCandidates || request.maxCandidates < request.targetCreatorCount) {
    return "최대 후보 수는 목표 인원 이상이어야 합니다.";
  }
  if (!request.parallelism || request.parallelism < 1) return "동시 협상 수는 1 이상이어야 합니다.";
  if (request.concessionPct !== undefined && (request.concessionPct < 1 || request.concessionPct > 100)) {
    return "양보율은 1~100% 사이여야 합니다.";
  }
  if (
    request.openingAmountUsdc !== undefined &&
    request.ceilingUsdc !== undefined &&
    request.openingAmountUsdc > request.ceilingUsdc
  ) {
    return "첫 제안 금액은 1인 상한보다 클 수 없습니다.";
  }
  return null;
}

type Field = {
  key: keyof CampaignFormValues;
  label: string;
  hint?: string;
  placeholder?: string;
  min?: number;
  max?: number;
};

const FIELDS: Field[] = [
  { key: "targetCreatorCount", label: "목표 인원", hint: "이만큼 합의되면 나머지 협상은 취소", min: 1, max: 20 },
  { key: "maxCandidates", label: "최대 후보", hint: "탐색 상위 n명의 agent card를 확인", min: 1, max: 20 },
  { key: "parallelism", label: "동시 협상 수", hint: "한 번에 여는 A2A 협상 수", min: 1, max: 10 },
  { key: "concessionPct", label: "양보율 (%)", hint: "역제안과의 차이를 얼마나 좁힐지", min: 1, max: 100 },
  { key: "openingAmountUsdc", label: "첫 제안 금액 (USDC)", hint: "비우면 프로모션의 원하는 금액", placeholder: "프로모션 기본값", min: 0 },
  { key: "ceilingUsdc", label: "1인 상한 (USDC)", hint: "비공개 · 크리에이터에게 전달되지 않음", placeholder: "프로모션 딜당 한도", min: 0 },
  { key: "maxRounds", label: "최대 라운드", hint: "비우면 프로모션 자율성 설정", placeholder: "기본값", min: 1, max: 20 },
];

export function CampaignForm({
  values,
  disabled,
  error,
  onChange,
  onSubmit,
}: {
  values: CampaignFormValues;
  disabled: boolean;
  error: string | null;
  onChange: (next: CampaignFormValues) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="sketch ink border border-border-subtle bg-surface p-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Campaign</p>
      <h2 className="mt-1 text-3xl">협상 조건</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <label key={field.key} className="block">
            <span className="block text-xs text-muted">{field.label}</span>
            <input
              type="number"
              inputMode="numeric"
              min={field.min}
              max={field.max}
              placeholder={field.placeholder}
              value={values[field.key]}
              disabled={disabled}
              onChange={(event) => onChange({ ...values, [field.key]: event.target.value })}
              className="mt-1 w-full border-2 border-border-subtle bg-background px-3 py-2 font-mono text-sm disabled:opacity-50"
            />
            {field.hint ? <span className="mt-1 block text-[11px] text-muted">{field.hint}</span> : null}
          </label>
        ))}
      </div>
      <button
        type="submit"
        disabled={disabled}
        className="sketch-pill mt-5 w-full bg-accent px-4 py-2.5 text-background disabled:opacity-50"
      >
        {disabled ? "캠페인 진행 중…" : "캠페인 시작"}
      </button>
      <p className="mt-3 text-[11px] leading-5 text-muted">
        탐색 → 상위 후보 agent card 확인 → 예산 예약 → 병렬 협상 → 목표 도달 시 나머지 취소 → 합의서·에스크로.
        1인 상한은 이 브라우저와 브랜드 API 사이에서만 오갑니다.
      </p>
      {error ? <p className="mt-3 text-sm text-negative">{error}</p> : null}
    </form>
  );
}
