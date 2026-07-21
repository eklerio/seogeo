import { NextResponse } from "next/server";
import { getSpendLog } from "@/lib/spend";
import { getBalance } from "@/lib/dataforseo";

export const dynamic = "force-dynamic";

export async function GET() {
  const [log, balanceUsd] = await Promise.all([getSpendLog(), getBalance()]);
  const today = new Date().toISOString().slice(0, 10);
  return NextResponse.json({
    totalUsd: log.totalUsd,
    totalCalls: log.totalCalls,
    todayUsd: log.byDay[today] ?? 0,
    byDay: log.byDay,
    recent: log.recent.slice(0, 20),
    balanceUsd,
  });
}
