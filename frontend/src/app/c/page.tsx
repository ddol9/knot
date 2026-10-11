"use client";

/** /c — 크리에이터 창 (미러: 브랜드 창을 실시간 반영). 로그인 필요. */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import "@/demo/demo.css";
import { initDemo } from "@/demo/engine/store";
import { useKnotSession } from "@/demo/auth/session";
import { CreatorApp } from "@/demo/creator/CreatorApp";

export default function CreatorDemoPage() {
  const router = useRouter();
  const session = useKnotSession();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initDemo("mirror");
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready && !session) router.replace("/auth?role=creator");
  }, [ready, session, router]);

  if (!ready || !session) {
    return <div data-knot-demo className="min-h-screen" />;
  }
  return (
    <div data-knot-demo className="min-h-screen">
      <CreatorApp />
    </div>
  );
}
