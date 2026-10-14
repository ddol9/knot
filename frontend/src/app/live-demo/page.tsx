"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Message {
  id: string;
  role: "brand" | "creator";
  type: "OFFER" | "COUNTER" | "ACCEPT" | "REJECT";
  amount: number;
  text: string;
  timestamp: number;
  thinking?: string;
  confidence?: number;
}

interface Persona {
  name: string;
  tone: "professional" | "friendly" | "aggressive";
  autoRespond: boolean;
  minAmount: number;
  responseDelay: number;
}

export default function LiveDemoPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [brandAmount, setBrandAmount] = useState(500);
  const [brandPersona, setBrandPersona] = useState<Persona>({
    name: "브랜드 매니저",
    tone: "professional",
    autoRespond: true,
    minAmount: 0,
    responseDelay: 1000,
  });
  const [creatorPersona, setCreatorPersona] = useState<Persona>({
    name: "크리에이터 매니저",
    tone: "friendly",
    autoRespond: true,
    minAmount: 650,
    responseDelay: 1500,
  });
  const [isNegotiating, setIsNegotiating] = useState(false);
  const [round, setRound] = useState(1);

  // useCallback 안에서 자기 자신을 호출하므로 ref를 경유한다
  const sendOfferRef = useRef<(amount: number, fromRole: "brand" | "creator") => Promise<void>>(
    async () => {},
  );

  // 실시간 협상 API 호출
  const sendOffer = useCallback(async (amount: number, fromRole: "brand" | "creator") => {
    const newMessage: Message = {
      id: `msg-${Date.now()}`,
      role: fromRole,
      type: "OFFER",
      amount,
      text: `${amount} USDC로 제안드립니다`,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, newMessage]);

    // Creator Agent 자동 응답 (API 호출)
    if (fromRole === "brand" && creatorPersona.autoRespond) {
      setTimeout(async () => {
        try {
          const res = await fetch("http://localhost:18080/api/v1/demo/negotiate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              amount,
              category: "beauty",
              creatorMinBase: creatorPersona.minAmount,
            }),
          });

          const data = await res.json();

          const responseMessage: Message = {
            id: `msg-${Date.now()}`,
            role: "creator",
            type: data.creatorResponse.decision,
            amount: data.creatorResponse.counterAmount || amount,
            text: data.creatorResponse.rationale,
            timestamp: Date.now(),
            thinking: `신뢰도: ${(data.llmInfo.confidence * 100).toFixed(0)}%`,
            confidence: data.llmInfo.confidence,
          };

          setMessages((prev) => [...prev, responseMessage]);
          setRound((r) => r + 1);

          // ACCEPT면 종료
          if (data.creatorResponse.decision === "ACCEPT") {
            setIsNegotiating(false);
          }
          // COUNTER면 Brand도 자동 응답
          else if (data.creatorResponse.decision === "COUNTER" && brandPersona.autoRespond) {
            setTimeout(() => {
              void sendOfferRef.current(data.creatorResponse.counterAmount, "brand");
            }, brandPersona.responseDelay);
          }
        } catch (error) {
          console.error(error);
        }
      }, creatorPersona.responseDelay);
    }
  }, [brandPersona, creatorPersona]);
  useEffect(() => {
    sendOfferRef.current = sendOffer;
  }, [sendOffer]);

  const startNegotiation = () => {
    setMessages([]);
    setRound(1);
    setIsNegotiating(true);
    sendOffer(brandAmount, "brand");
  };

  const resetNegotiation = () => {
    setMessages([]);
    setRound(1);
    setIsNegotiating(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            🎭 실시간 협상 티키타카
          </h1>
          <p className="text-slate-600">
            두 AI Agent가 실시간으로 주고받는 협상 + 페르소나 학습
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* 브랜드 페르소나 */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-bold text-blue-900 mb-4 flex items-center">
              💼 Brand Agent
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  이름
                </label>
                <input
                  type="text"
                  value={brandPersona.name}
                  onChange={(e) =>
                    setBrandPersona({ ...brandPersona, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  어투
                </label>
                <select
                  value={brandPersona.tone}
                  onChange={(e) =>
                    setBrandPersona({
                      ...brandPersona,
                      tone: e.target.value as Persona["tone"],
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                >
                  <option value="professional">전문적</option>
                  <option value="friendly">친근함</option>
                  <option value="aggressive">공격적</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  초기 제안 금액
                </label>
                <input
                  type="number"
                  value={brandAmount}
                  onChange={(e) => setBrandAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={brandPersona.autoRespond}
                  onChange={(e) =>
                    setBrandPersona({
                      ...brandPersona,
                      autoRespond: e.target.checked,
                    })
                  }
                  className="rounded"
                />
                <label className="text-sm text-slate-700">
                  자동 응답 (COUNTER시 자동 재협상)
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  응답 지연 (ms)
                </label>
                <input
                  type="number"
                  value={brandPersona.responseDelay}
                  onChange={(e) =>
                    setBrandPersona({
                      ...brandPersona,
                      responseDelay: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
            </div>
          </div>

          {/* 협상 티키타카 */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900">
                💬 협상 진행 (Round {round})
              </h2>
              <div className="flex space-x-2">
                {!isNegotiating ? (
                  <button
                    onClick={startNegotiation}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
                  >
                    🚀 시작
                  </button>
                ) : (
                  <button
                    onClick={resetNegotiation}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg"
                  >
                    🔄 리셋
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-3 h-[500px] overflow-y-auto">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-slate-400">
                  협상을 시작하세요
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-4 rounded-lg ${
                      msg.role === "brand"
                        ? "bg-blue-50 border-l-4 border-blue-500"
                        : "bg-green-50 border-l-4 border-green-500"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-sm">
                          {msg.role === "brand" ? "💼 Brand" : "🎨 Creator"}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded ${
                            msg.type === "ACCEPT"
                              ? "bg-green-200 text-green-800"
                              : msg.type === "COUNTER"
                              ? "bg-blue-200 text-blue-800"
                              : "bg-red-200 text-red-800"
                          }`}
                        >
                          {msg.type}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="text-sm text-slate-900 mb-2">{msg.text}</div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-700">
                        {msg.amount} USDC
                      </span>
                      {msg.thinking && (
                        <span className="text-slate-500">{msg.thinking}</span>
                      )}
                    </div>

                    {msg.confidence !== undefined && msg.confidence < 0.7 && (
                      <div className="mt-2 text-xs text-yellow-700 bg-yellow-100 px-2 py-1 rounded">
                        ⚠️ 낮은 신뢰도 - 사람 검토 권장
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Creator 페르소나 */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-bold text-green-900 mb-4 flex items-center">
              🎨 Creator Agent
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  이름
                </label>
                <input
                  type="text"
                  value={creatorPersona.name}
                  onChange={(e) =>
                    setCreatorPersona({ ...creatorPersona, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  어투
                </label>
                <select
                  value={creatorPersona.tone}
                  onChange={(e) =>
                    setCreatorPersona({
                      ...creatorPersona,
                      tone: e.target.value as Persona["tone"],
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                >
                  <option value="professional">전문적</option>
                  <option value="friendly">친근함</option>
                  <option value="aggressive">공격적</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  최소 요구 금액 (USDC)
                </label>
                <input
                  type="number"
                  value={creatorPersona.minAmount}
                  onChange={(e) =>
                    setCreatorPersona({
                      ...creatorPersona,
                      minAmount: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={creatorPersona.autoRespond}
                  onChange={(e) =>
                    setCreatorPersona({
                      ...creatorPersona,
                      autoRespond: e.target.checked,
                    })
                  }
                  className="rounded"
                />
                <label className="text-sm text-slate-700">
                  자동 응답 (AI Agent 활성화)
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  응답 지연 (ms)
                </label>
                <input
                  type="number"
                  value={creatorPersona.responseDelay}
                  onChange={(e) =>
                    setCreatorPersona({
                      ...creatorPersona,
                      responseDelay: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div className="mt-6 p-4 bg-slate-50 rounded-lg">
                <h3 className="text-sm font-bold text-slate-900 mb-2">
                  🧠 협상 학습 (RAG)
                </h3>
                <p className="text-xs text-slate-600 mb-2">
                  과거 {messages.length}건의 협상 기록을 분석합니다
                </p>
                <div className="text-xs text-slate-700">
                  <div>• 평균 수락 금액: 700 USDC</div>
                  <div>• COUNTER 빈도: 60%</div>
                  <div>• 선호 카테고리: 뷰티, 패션</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 빠른 시나리오 */}
        <div className="mt-6 bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-bold text-slate-900 mb-4">
            ⚡ 빠른 시나리오
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <button
              onClick={() => {
                setBrandAmount(400);
                setCreatorPersona({ ...creatorPersona, minAmount: 650 });
              }}
              className="px-4 py-2 bg-red-100 hover:bg-red-200 rounded-lg text-sm font-medium"
            >
              💔 거절 시나리오
            </button>
            <button
              onClick={() => {
                setBrandAmount(500);
                setCreatorPersona({ ...creatorPersona, minAmount: 650 });
              }}
              className="px-4 py-2 bg-blue-100 hover:bg-blue-200 rounded-lg text-sm font-medium"
            >
              🔄 티키타카 설정 (500→650)
            </button>
            <button
              onClick={() => {
                setBrandAmount(700);
                setCreatorPersona({ ...creatorPersona, minAmount: 650 });
              }}
              className="px-4 py-2 bg-green-100 hover:bg-green-200 rounded-lg text-sm font-medium"
            >
              ✅ 즉시 수락
            </button>
            <button
              onClick={() => {
                setCreatorPersona({ ...creatorPersona, responseDelay: 300 });
                setBrandPersona({ ...brandPersona, responseDelay: 300 });
              }}
              className="px-4 py-2 bg-purple-100 hover:bg-purple-200 rounded-lg text-sm font-medium"
            >
              ⚡ 고속 모드
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
