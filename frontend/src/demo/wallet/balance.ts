"use client";

/**
 * 실제 devnet USDC 잔액 조회 — 가짜 숫자 대신 체인에서 읽는다.
 * 에스크로 릴리즈가 실제 송금을 하면 폴링으로 잔액이 올라가는 게 보인다.
 */

import { useEffect, useRef, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";

const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_KNOT_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

let connection: Connection | null = null;
function conn() {
  connection ??= new Connection(RPC_URL, "confirmed");
  return connection;
}

export async function fetchUsdcBalance(owner: string): Promise<number | null> {
  try {
    const res = await conn().getParsedTokenAccountsByOwner(new PublicKey(owner), {
      mint: USDC_MINT,
    });
    return res.value.reduce(
      (sum, a) => sum + (a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0),
      0,
    );
  } catch {
    return null;
  }
}

/**
 * 주소의 실시간 USDC 잔액 훅. 15초 폴링 — 입금이 오면 delta가 잠깐 뜬다.
 * address가 없으면 null(연결 안 됨).
 */
export function useUsdcBalance(address: string | null | undefined, pollMs = 15_000) {
  const [balance, setBalance] = useState<number | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const prev = useRef<number | null>(null);

  useEffect(() => {
    if (!address) return;
    let alive = true;
    prev.current = null;
    const load = async () => {
      const b = await fetchUsdcBalance(address);
      if (!alive) return;
      if (b === null) {
        // 잘못된 주소/RPC 실패 — "조회 중…"에 갇히지 않게 실패로 표시
        setFailed(true);
        return;
      }
      setFailed(false);
      if (prev.current !== null && b > prev.current) {
        setDelta(b - prev.current);
        setTimeout(() => alive && setDelta(null), 2500);
      }
      prev.current = b;
      setBalance(b);
    };
    void load();
    const t = setInterval(load, pollMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [address, pollMs]);

  if (!address) return { balance: null, delta: null, failed: false };
  return { balance, delta, failed };
}

export function formatUsdc(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
