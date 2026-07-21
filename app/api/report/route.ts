import { NextResponse } from "next/server";
import { getActiveDestination, listDestinations, addReport, listReports } from "@/lib/store";
import { runReport } from "@/lib/report";
import { hostOf } from "@/lib/dataforseo";
import type { Destination } from "@/lib/store";
import type { Snapshot } from "@/lib/report";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function resolveDest(id: string | null) {
  if (!id) return getActiveDestination();
  const all = await listDestinations();
  return all.find((d) => d.id === id) ?? null;
}

// Only snapshots about the destination's CURRENT company (matched by website host). When the user
// re-points a destination at a different site, the old company's snapshots stop matching — so the
// dashboard goes back to the empty state, and the first new run has nothing to compare against.
function reportsForSubject(reports: Snapshot[], dest: Destination): Snapshot[] {
  const host = hostOf(dest.url);
  return reports.filter((r) => r.subject === host);
}

type TrendPoint = {
  weekOf: string;
  createdAt: string;
  aiShareOfVoice: number | null;
  avgGoogleRank: number | null;
  avgBingRank: number | null;
  estVisits: number | null;
};

// One point per week for the Overview trend chart. AI answers are cached weekly (flat within a
// week) while Google ranks refresh per run, so we collapse each week to its LAST run — the most
// complete, freshest snapshot — instead of plotting every run and showing misleading wiggles.
function weeklyTrend(reports: Snapshot[]): TrendPoint[] {
  const byWeek = new Map<string, Snapshot>();
  for (const r of reports) byWeek.set(r.weekOf, r); // reports are oldest-first → last run wins
  return [...byWeek.values()].map((s) => ({
    weekOf: s.weekOf,
    createdAt: s.createdAt,
    aiShareOfVoice: s.metrics.aiShareOfVoice,
    avgGoogleRank: s.metrics.avgGoogleRank,
    avgBingRank: s.metrics.avgBingRank ?? null,
    estVisits: s.metrics.estVisits ?? null,
  }));
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const dest = await resolveDest(id);
  if (!dest) return NextResponse.json({ error: "no_destination" }, { status: 404 });
  const reports = reportsForSubject(await listReports(dest.id), dest);
  const current = reports[reports.length - 1] ?? null;
  const previous = reports[reports.length - 2] ?? null;
  return NextResponse.json({ current, previous, trend: weeklyTrend(reports) });
}

export async function POST(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const dest = await resolveDest(id);
  if (!dest) return NextResponse.json({ error: "no_destination" }, { status: 404 });

  try {
    const snapshot = await runReport(dest);
    await addReport(snapshot);
    const reports = reportsForSubject(await listReports(dest.id), dest);
    return NextResponse.json({
      current: reports[reports.length - 1] ?? snapshot,
      previous: reports[reports.length - 2] ?? null,
      trend: weeklyTrend(reports),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "report_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
