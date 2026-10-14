"use client";

import { useState } from "react";

type Decision = "ACCEPT" | "COUNTER" | "REJECT" | "ESCALATE";

interface NegotiateResponse {
  brandOffer: {
    amount: number;
    category: string;
    title: string;
    deliverable: string;
    usageRights: string;
  };
  creatorResponse: {
    decision: Decision;
    rationale: string;
    counterAmount?: number;
  };
  policyDecision: {
    allowed: boolean;
    violations: Array<{ code: string; field: string }>;
  };
  llmInfo: {
    provider: string;
    model: string | null;
    confidence: number;
    mode: string;
  };
}

export default function DemoPage() {
  const [amount, setAmount] = useState(500);
  const [category, setCategory] = useState("beauty");
  const [creatorMin, setCreatorMin] = useState(650);
  const [response, setResponse] = useState<NegotiateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNegotiate = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("http://localhost:18080/api/v1/demo/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          category,
          creatorMinBase: creatorMin,
        }),
      });

      if (!res.ok) {
        throw new Error(`API Error: ${res.status}`);
      }

      const data = await res.json();
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const getDecisionColor = (decision: Decision) => {
    switch (decision) {
      case "ACCEPT":
        return "text-green-600 bg-green-50";
      case "COUNTER":
        return "text-blue-600 bg-blue-50";
      case "REJECT":
        return "text-red-600 bg-red-50";
      case "ESCALATE":
        return "text-yellow-600 bg-yellow-50";
      default:
        return "text-gray-600 bg-gray-50";
    }
  };

  const getDecisionEmoji = (decision: Decision) => {
    switch (decision) {
      case "ACCEPT":
        return "✅";
      case "COUNTER":
        return "🔄";
      case "REJECT":
        return "❌";
      case "ESCALATE":
        return "⚠️";
      default:
        return "❓";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="max-w-6xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            🤖 KNOT AI Agent 협상 시뮬레이터
          </h1>
          <p className="text-slate-600">
            로그인 없이 바로 테스트 | Vertex AI Gemini + CoT 프롬프트
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 입력 패널 */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center">
              💼 Brand Agent 제안
            </h2>

            <div className="space-y-4">
              {/* 금액 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  제안 금액 (USDC)
                </label>
                <div className="flex items-center space-x-4">
                  <input
                    type="range"
                    min="100"
                    max="1500"
                    step="50"
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="flex-1 h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                  />
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-center font-bold"
                  />
                </div>
              </div>

              {/* 카테고리 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  카테고리
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="beauty">뷰티</option>
                  <option value="fashion">패션</option>
                  <option value="food">푸드</option>
                  <option value="tech">테크</option>
                </select>
              </div>

              {/* Creator 최소 금액 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Creator 최소 요구 금액 (USDC)
                </label>
                <input
                  type="number"
                  value={creatorMin}
                  onChange={(e) => setCreatorMin(Number(e.target.value))}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              {/* 버튼 */}
              <button
                onClick={handleNegotiate}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold py-3 px-6 rounded-lg transition-colors"
              >
                {loading ? "⏳ 협상 중..." : "🚀 협상 시작"}
              </button>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                  ❌ {error}
                </div>
              )}
            </div>
          </div>

          {/* 결과 패널 */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center">
              🎨 Creator Agent 응답
            </h2>

            {!response ? (
              <div className="flex items-center justify-center h-64 text-slate-400">
                <div className="text-center">
                  <p className="text-lg mb-2">👈 좌측에서 조건을 설정하고</p>
                  <p className="text-lg">협상을 시작하세요</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 결정 */}
                <div className={`p-4 rounded-lg ${getDecisionColor(response.creatorResponse.decision)}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">결정</span>
                    <span className="text-2xl">
                      {getDecisionEmoji(response.creatorResponse.decision)}
                    </span>
                  </div>
                  <div className="text-2xl font-bold">
                    {response.creatorResponse.decision}
                  </div>
                </div>

                {/* 응답 메시지 */}
                <div className="bg-slate-50 p-4 rounded-lg">
                  <div className="text-sm font-medium text-slate-700 mb-2">
                    응답 메시지
                  </div>
                  <div className="text-slate-900">
                    {response.creatorResponse.rationale}
                  </div>
                </div>

                {/* Counter Amount */}
                {response.creatorResponse.counterAmount && (
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <div className="text-sm font-medium text-blue-700 mb-1">
                      수정 제안 금액
                    </div>
                    <div className="text-2xl font-bold text-blue-900">
                      {response.creatorResponse.counterAmount} USDC
                    </div>
                  </div>
                )}

                {/* 정책 위반 */}
                {response.policyDecision.violations.length > 0 && (
                  <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                    <div className="text-sm font-medium text-red-700 mb-2">
                      ⚠️ 정책 위반
                    </div>
                    {response.policyDecision.violations.map((v, i) => (
                      <div key={i} className="text-sm text-red-600">
                        • {v.code}
                      </div>
                    ))}
                  </div>
                )}

                {/* LLM 정보 */}
                <div className="bg-slate-100 p-4 rounded-lg text-xs space-y-1">
                  <div className="font-medium text-slate-700">
                    🤖 LLM 정보
                  </div>
                  <div className="text-slate-600">
                    Provider: {response.llmInfo.provider}
                  </div>
                  <div className="text-slate-600">
                    Model: {response.llmInfo.model || "N/A"}
                  </div>
                  <div className="text-slate-600">
                    Confidence: {(response.llmInfo.confidence * 100).toFixed(0)}%
                  </div>
                  <div className="text-slate-600">
                    Mode: {response.llmInfo.mode}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 빠른 테스트 버튼 */}
        <div className="mt-8 bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-bold text-slate-900 mb-4">
            ⚡ 빠른 시나리오 테스트
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <button
              onClick={() => {
                setAmount(400);
                setCategory("beauty");
                setCreatorMin(650);
              }}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium"
            >
              💔 거절 (400 USDC)
            </button>
            <button
              onClick={() => {
                setAmount(500);
                setCategory("beauty");
                setCreatorMin(650);
              }}
              className="px-4 py-2 bg-blue-100 hover:bg-blue-200 rounded-lg text-sm font-medium"
            >
              🔄 카운터 (500 USDC)
            </button>
            <button
              onClick={() => {
                setAmount(650);
                setCategory("beauty");
                setCreatorMin(650);
              }}
              className="px-4 py-2 bg-green-100 hover:bg-green-200 rounded-lg text-sm font-medium"
            >
              ✅ 수락 (650 USDC)
            </button>
            <button
              onClick={() => {
                setAmount(1000);
                setCategory("fashion");
                setCreatorMin(650);
              }}
              className="px-4 py-2 bg-green-100 hover:bg-green-200 rounded-lg text-sm font-medium"
            >
              ✨ 고액 (1000 USDC)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
