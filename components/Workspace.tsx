"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DestinationForm, { type DestinationInput } from "./DestinationForm";
import InstantCheck from "./InstantCheck";
import { ALL_ENGINES, ENGINE_LABEL, destEngines, engineLabels, type EngineId } from "@/lib/engines";

type Destination = DestinationInput & { id: string; createdAt: string; engines?: string[] };

type RankRow = {
  query?: string;
  question?: string;
  position: number | null;
  bingPosition?: number | null;
  aiOverview?: { present: boolean; cited: boolean };
  searchVolume?: number | null;
  difficulty?: number | null;
  bingSearchVolume?: number | null;
  bingCompetition?: number | null;
};

type TrafficRow = {
  name: string;
  domain: string;
  isCompany: boolean;
  estVisits: number | null;
  keywordCount: number | null;
};

type KeywordGap = {
  keyword: string;
  searchVolume: number | null;
  competitor: string;
  competitorRank: number;
};

type IntentBucket = { total: number; appeared: number; rate: number | null };
type QuestionVisibility = {
  text: string;
  type: "Commercial" | "Informational";
  answered: boolean;
  appeared: boolean;
};

type RunEstimate = {
  totalUsd: number;
  firstOfWeek: boolean;
  perQuestionUsd: number;
  perKeywordUsd: number;
};

type StoredAnswers = {
  // Per chatbot, aligned to the tracked-question order; null = nothing saved yet.
  engines: Partial<Record<EngineId, string[] | null>>;
  fetchedAt: string | null;
};

type Snapshot = {
  createdAt: string;
  weekOf: string;
  costUsd?: number; // data spend this run added (near-zero on cached same-week re-runs)
  metrics: {
    aiShareOfVoice: number | null;
    aiPerEngine: Partial<Record<EngineId, number | null>>;
    aiEngineAppearance?: Partial<Record<EngineId, { appeared: number; answered: number }>>; // absent on legacy snapshots
    intentVisibility?: { commercial: IntentBucket; informational: IntentBucket }; // absent on legacy snapshots
    avgGoogleRank: number | null;
    rankedCount: number;
    avgBingRank?: number | null; // absent on snapshots from before Bing was tracked
    bingRankedCount?: number;
    totalQueries: number;
    totalQuestions?: number; // legacy snapshots, before keywords
    aiOverviewPresent?: number; // legacy snapshots predate these
    aiOverviewCited?: number;
    estVisits?: number | null;
    realVisits: number | null;
    googleImpressions: number | null;
  };
  ranks?: RankRow[];
  questionVisibility?: QuestionVisibility[]; // absent on legacy snapshots
  traffic?: TrafficRow[];
  keywordGaps?: KeywordGap[];
  recommendations?: Recommendation[]; // absent on legacy snapshots
};

type Recommendation = { title: string; why: string };

type TrendPoint = {
  weekOf: string;
  createdAt: string;
  aiShareOfVoice: number | null;
  avgGoogleRank: number | null;
  avgBingRank: number | null;
  estVisits: number | null;
};

export const TABS = ["Instant Check", "Overview", "GEO", "Search", "Competitors", "Action Plan"] as const;
export type Tab = (typeof TABS)[number];

export function TabIcon({ tab }: { tab: Tab }) {
  const p = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "shrink-0",
    "aria-hidden": true,
  };
  switch (tab) {
    case "Instant Check":
      return (
        <svg {...p}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case "Overview":
      return (
        <svg {...p}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "GEO":
      return (
        <svg {...p}>
          <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.3 8.9 8.9 0 0 1-3.2-.6L3 21l1.8-5.2A8.1 8.1 0 0 1 4 11.5 8.38 8.38 0 0 1 12.5 3.2 8.38 8.38 0 0 1 21 11.5z" />
        </svg>
      );
    case "Search":
      return (
        <svg {...p}>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      );
    case "Competitors":
      return (
        <svg {...p}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
          <circle cx="10" cy="7" r="4" />
          <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "Action Plan":
      return (
        <svg {...p}>
          <path d="M9 6h11" />
          <path d="M9 12h11" />
          <path d="M9 18h11" />
          <path d="m3.5 6 1 1 2-2" />
          <path d="m3.5 12 1 1 2-2" />
          <path d="m3.5 18 1 1 2-2" />
        </svg>
      );
  }
}

export function GearIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

type RealData = {
  googleConnected: boolean;
  gsc: {
    siteUrl: string;
    current: { impressions: number; clicks: number };
    previous: { impressions: number; clicks: number } | null;
  } | null;
  ga4: {
    propertyIdSet: boolean;
    data: {
      current: {
        visits: number;
        aiVisits: number;
        aiSources: { source: string; sessions: number }[];
        aiPages?: { page: string; sessions: number; sources: string[] }[];
      };
      previous: { visits: number; aiVisits: number } | null;
    } | null;
  };
};

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
export function favicon(url: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(url))}&sz=64`;
}

/** Engines present in a snapshot's per-engine metrics, in the registry's stable order. */
function snapshotEngines(per?: Partial<Record<EngineId, unknown>>): EngineId[] {
  return per ? ALL_ENGINES.filter((e) => e in per) : [];
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = 60_000,
    hr = 3_600_000,
    day = 86_400_000;
  if (diff < min) return "just now";
  if (diff < hr) {
    const m = Math.floor(diff / min);
    return `${m} minute${m > 1 ? "s" : ""} ago`;
  }
  if (diff < day) {
    const h = Math.floor(diff / hr);
    return `${h} hour${h > 1 ? "s" : ""} ago`;
  }
  const d = Math.floor(diff / day);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return shortDate(iso);
}

export default function Workspace({
  destination,
  destinations,
  initialTab = "Overview",
  instantCosts,
}: {
  destination: Destination;
  destinations: Destination[];
  initialTab?: Tab;
  instantCosts: Record<EngineId, number>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [boardsOpen, setBoardsOpen] = useState(false);

  // Local copy so inline add/remove of questions & phrases updates the UI instantly.
  const [dest, setDest] = useState<Destination>(destination);
  useEffect(() => setDest(destination), [destination]);
  const [savingList, setSavingList] = useState(false);

  const saveDest = useCallback(async (next: Destination) => {
    setDest(next); // optimistic
    setSavingList(true);
    try {
      await fetch("/api/destinations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch {
      // keep optimistic state; a later report run or refresh re-syncs from the server
    } finally {
      setSavingList(false);
    }
  }, []);

  const [current, setCurrent] = useState<Snapshot | null>(null);
  const [previous, setPrevious] = useState<Snapshot | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [running, setRunning] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<RunEstimate | null>(null);

  const loadEstimate = useCallback(() => {
    fetch("/api/report/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dest),
    })
      .then((r) => r.json())
      .then((d) => setEstimate(d))
      .catch(() => {});
  }, [dest]);

  // Re-price whenever the tracked lists change (questions/phrases/competitors edited).
  useEffect(() => {
    loadEstimate();
  }, [loadEstimate]);
  const [spend, setSpend] = useState<{
    totalUsd: number;
    todayUsd: number;
    balanceUsd: number | null;
  } | null>(null);

  const loadSpend = useCallback(() => {
    fetch("/api/spend")
      .then((r) => r.json())
      .then((d) => setSpend({ totalUsd: d.totalUsd, todayUsd: d.todayUsd, balanceUsd: d.balanceUsd }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSpend();
  }, [loadSpend]);

  const [realData, setRealData] = useState<RealData | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/realdata?id=${destination.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (live && !d.message) setRealData(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [destination.id]);

  useEffect(() => {
    let live = true;
    fetch(`/api/report?id=${destination.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        setCurrent(d.current ?? null);
        setPrevious(d.previous ?? null);
        setTrend(d.trend ?? []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [destination.id]);

  const runReport = useCallback(async () => {
    setRunning(true);
    setReportError(null);
    try {
      const res = await fetch(`/api/report?id=${destination.id}`, { method: "POST" });
      const text = await res.text();
      let d: { current?: Snapshot; previous?: Snapshot; trend?: TrendPoint[]; message?: string } = {};
      try {
        d = JSON.parse(text);
      } catch {
        throw new Error(
          res.status === 0 || res.status >= 500
            ? "The report took too long and timed out. Please try again."
            : "Something went wrong running the report. Please try again."
        );
      }
      if (!res.ok) throw new Error(d.message || "Report failed");
      setCurrent(d.current ?? null);
      setPrevious(d.previous ?? null);
      setTrend(d.trend ?? []);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Report failed");
    } finally {
      setRunning(false);
      loadSpend();
      loadEstimate(); // a fresh run warms the caches, so the next run is cheaper
    }
  }, [destination.id, loadSpend, loadEstimate]);

  return (
    <div className="flex min-h-screen flex-col-reverse lg:flex-row">
      {/* Body */}
      <main className="min-w-0 flex-1 px-6 py-8">
        <div className="mx-auto max-w-6xl">
          {tab === "Instant Check" && (
            <InstantCheck
              destination={dest}
              costs={instantCosts}
              onAddQuestion={(q) => saveDest({ ...dest, questions: [...dest.questions, q] })}
            />
          )}
          {tab === "Overview" && (
            <Overview
              current={current}
              previous={previous}
              trend={trend}
              realData={realData}
              destId={dest.id}
              onNavigate={setTab}
            />
          )}
          {tab === "GEO" && (
            <AiAnswers
              destination={dest}
              current={current}
              previous={previous}
              realData={realData}
              estimate={estimate}
              onSave={saveDest}
              saving={savingList}
            />
          )}
          {tab === "Search" && (
            <SearchTab
              destination={dest}
              current={current}
              estimate={estimate}
              onSave={saveDest}
              saving={savingList}
            />
          )}
          {tab === "Competitors" && <Competitors destination={dest} current={current} />}
          {tab === "Action Plan" && <ActionPlan current={current} />}
        </div>
      </main>

      {/* Left sidebar */}
      <aside className="flex w-full shrink-0 flex-col gap-6 border-b border-edge bg-panel/60 px-5 py-6 lg:sticky lg:top-0 lg:order-first lg:h-screen lg:w-72 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/glinton-solid.png" alt="Glinton" className="h-6 w-auto" />
        </div>

        <div className="relative">
          <button
            onClick={() => setBoardsOpen((o) => !o)}
            title="Switch board"
            className="flex w-full items-center gap-3 rounded-xl border border-transparent p-1.5 -m-1.5 text-left transition hover:border-edge hover:bg-panel-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={favicon(dest.url)}
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 rounded-xl border border-edge bg-panel-2 p-1.5"
            />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-bold text-foreground">{dest.companyName}</h1>
              <p className="truncate text-xs text-muted">
                {hostOf(dest.url)} · {dest.country} · {dest.language}
              </p>
            </div>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`shrink-0 text-muted transition-transform ${boardsOpen ? "rotate-180" : ""}`}
              aria-hidden
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {boardsOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setBoardsOpen(false)} />
              <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-xl border border-edge bg-panel-2 shadow-md">
                <p className="border-b border-edge px-3 py-2 text-xs font-semibold text-muted">
                  Boards ({destinations.length})
                </p>
                <div className="max-h-64 overflow-y-auto p-1">
                  {destinations.map((d) => {
                    const activeBoard = d.id === dest.id;
                    return (
                      <button
                        key={d.id}
                        onClick={() => {
                          setBoardsOpen(false);
                          if (!activeBoard)
                            router.push(`/workspace?board=${d.id}&tab=${encodeURIComponent(tab)}`);
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                          activeBoard
                            ? "bg-[#dbeaff] font-medium text-foreground"
                            : "text-foreground hover:bg-panel"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={favicon(d.url)}
                          alt=""
                          width={20}
                          height={20}
                          className="h-5 w-5 shrink-0 rounded border border-edge bg-panel-2 p-0.5"
                        />
                        <span className="min-w-0 flex-1 truncate">{d.companyName}</span>
                        <span className="shrink-0 text-xs text-muted">{hostOf(d.url)}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => {
                    setBoardsOpen(false);
                    router.push("/start?new=1");
                  }}
                  className="w-full border-t border-edge px-3 py-2.5 text-center text-sm font-semibold text-accent transition hover:bg-panel"
                >
                  ＋ Add board
                </button>
              </div>
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <button
            onClick={runReport}
            disabled={running}
            title={
              estimate
                ? estimate.firstOfWeek
                  ? "Full weekly run. Refreshes everything."
                  : "Quick re-run. Refreshes Google rankings only."
                : undefined
            }
            className="w-full rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black/85 disabled:opacity-60"
          >
            {running ? (
              "Running…"
            ) : (
              <span className="flex items-center justify-center gap-1.5">
                <span>{current ? "Run report" : "Run first report"}</span>
                {estimate && (
                  <span className="font-normal text-white/60">{formatCost(estimate.totalUsd)}</span>
                )}
              </span>
            )}
          </button>
          {running ? (
            <p className="px-0.5 text-[11px] text-muted">
              Asking {engineLabels(destEngines(dest.engines))} and checking Google rankings — this
              can take a minute.
            </p>
          ) : (
            <p
              className="px-0.5 text-[11px] text-muted"
              title={
                spend
                  ? `Total spent $${spend.totalUsd.toFixed(2)} · today $${spend.todayUsd.toFixed(2)}${
                      spend.balanceUsd != null ? ` · $${spend.balanceUsd.toFixed(2)} left` : ""
                    }`
                  : undefined
              }
            >
              {current ? `Updated ${relativeTime(current.createdAt)}` : "No report yet"}
              {spend ? ` · ${formatCost(spend.totalUsd)} spent` : ""}
              {spend?.balanceUsd != null ? ` · $${spend.balanceUsd.toFixed(2)} left` : ""}
            </p>
          )}
          {reportError && <p className="px-0.5 text-xs text-rose-600">{reportError}</p>}
        </div>

        <nav className="flex flex-col gap-1">
          {TABS.map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? "bg-[#dbeaff] text-foreground" : "text-muted hover:bg-black/[0.03] hover:text-foreground"
                }`}
              >
                <span className={active ? "text-accent" : undefined}>
                  <TabIcon tab={t} />
                </span>
                {t}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-edge/70 pt-3">
          <button
            onClick={() => router.push(`/workspace/settings?board=${dest.id}`)}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:bg-black/[0.03] hover:text-foreground"
          >
            <GearIcon />
            Settings
          </button>
        </div>
      </aside>
    </div>
  );
}

/* ---------- Overview ---------- */

function Overview({
  current,
  previous,
  trend,
  realData,
  destId,
  onNavigate,
}: {
  current: Snapshot | null;
  previous: Snapshot | null;
  trend: TrendPoint[];
  realData: RealData | null;
  destId: string;
  onNavigate: (tab: Tab) => void;
}) {
  const router = useRouter();
  const cur = current?.metrics;
  const prev = previous?.metrics;
  const ga4 = realData?.ga4?.data ?? null;

  return (
    <div className="space-y-6">
      {/* Headline numbers */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
          Your visibility
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="AI Share of Voice"
            type="percent"
            higherIsBetter
            current={cur?.aiShareOfVoice ?? null}
            previous={prev?.aiShareOfVoice ?? null}
            hasReport={!!current}
            tip="How often AI chatbots name your company when answering questions, versus competitors. Higher is better: it means AI recommends you more."
            onClick={() => onNavigate("GEO")}
          />
          {ga4 ? (
            <MetricCard
              label="Real Visits"
              type="count"
              higherIsBetter
              current={ga4.current.visits}
              previous={ga4.previous?.visits ?? null}
              hasReport
              subtext="all sources, Analytics · last 7 days"
              tip="Real visits from Google Analytics across all sources."
            />
          ) : (
            <MetricCard
              label="Est. Google Visits"
              type="count"
              higherIsBetter
              current={cur?.estVisits ?? null}
              previous={prev?.estVisits ?? null}
              hasReport={!!current}
              subtext="estimated · connect Google Analytics to see real data"
              tip="Estimated monthly visits from Google search, based on your rankings and how often your phrases are searched. Connect Google Analytics to see real numbers."
              onClick={() => router.push(`/workspace/settings?board=${destId}&section=connections`)}
            />
          )}
          <MetricCard
            label="Avg Google Rank"
            type="rank"
            higherIsBetter={false}
            current={cur?.avgGoogleRank ?? null}
            previous={prev?.avgGoogleRank ?? null}
            hasReport={!!current}
            subtext={
              cur
                ? `${cur.rankedCount} of ${cur.totalQueries ?? cur.totalQuestions ?? cur.rankedCount} ranked`
                : undefined
            }
            tip="Your average Google position across all phrases. 1 is the top, so lower is better. ‘5 of 15 ranked’ means 5 phrases show up in Google’s top 100."
            onClick={() => onNavigate("Search")}
          />
          <MetricCard
            label="Avg Bing Rank"
            type="rank"
            higherIsBetter={false}
            current={cur?.avgBingRank ?? null}
            previous={prev?.avgBingRank ?? null}
            hasReport={!!current}
            subtext={
              cur && cur.avgBingRank !== undefined
                ? `${cur.bingRankedCount ?? 0} of ${cur.totalQueries ?? cur.rankedCount} ranked`
                : undefined
            }
            tip="Your average Bing position across all phrases. 1 is the top, so lower is better. Bing powers ChatGPT web search and Copilot, so ranking here helps you show up in AI answers too."
            onClick={() => onNavigate("Search")}
          />
          <MetricCard
            label="Google AI Overview"
            type="count"
            higherIsBetter
            current={cur?.aiOverviewCited ?? null}
            previous={prev?.aiOverviewCited ?? null}
            hasReport={!!current}
            subtext={cur ? `cite you · of ${cur.aiOverviewPresent ?? 0} that show one` : undefined}
            tip="Google's AI summary at the top of search. The number is how many name your company as a source. Higher is better."
            onClick={() => onNavigate("Search")}
          />
          <EnginePairCard
            hasReport={!!current}
            per={cur?.aiPerEngine}
            prevPer={prev?.aiPerEngine}
            tip="Your AI Share of Voice split by chatbot, so you can see where you're stronger. Higher is better."
            onClick={() => onNavigate("GEO")}
          />
        </div>
      </section>

      <RealityCheck data={realData} onNavigate={onNavigate} />

      {/* Trend over time */}
      <TrendChart trend={trend} />
    </div>
  );
}

/* ---------- Reality check (Overview) ---------- */

function RealityCheck({ data, onNavigate }: { data: RealData | null; onNavigate: (tab: Tab) => void }) {
  const googleConnected = data?.googleConnected ?? false;
  const gsc = data?.gsc ?? null;
  const ga4 = data?.ga4.data ?? null;
  const ga4IdSet = data?.ga4.propertyIdSet ?? false;

  const gscMissing = googleConnected ? "no Search Console data yet" : "Sign in with Google in Connections";
  const ga4Missing = !googleConnected
    ? "Sign in with Google in Connections"
    : !ga4IdSet
      ? "add your GA4 property ID in Connections"
      : "no Analytics data yet";

  const aiSources = ga4?.current.aiSources ?? [];
  const aiSubtext = ga4
    ? aiSources.length
      ? aiSources.map((s) => `${s.source.replace(/^www\./, "")} ${s.sessions}`).join(" · ")
      : "none yet — watch this grow"
    : ga4Missing;

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted">
        Traffic and clicks
      </h2>
      <p className="mb-3 text-xs text-muted">
        Your real numbers from Search Console and Analytics. This week vs last week.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Google Impressions"
          type="count"
          higherIsBetter
          current={gsc?.current.impressions ?? null}
          previous={gsc?.previous?.impressions ?? null}
          hasReport={!!gsc}
          subtext={gsc ? "times you appeared in Google" : gscMissing}
          tip="How many times your site showed up in Google results in the last 7 days. Higher is better."
        />
        <MetricCard
          label="Clicks from Google"
          type="count"
          higherIsBetter
          current={gsc?.current.clicks ?? null}
          previous={gsc?.previous?.clicks ?? null}
          hasReport={!!gsc}
          subtext={gsc ? "real clicks, Search Console" : gscMissing}
          tip="How many people clicked to your site from Google in the last 7 days. Higher is better."
        />
        <MetricCard
          label="Real Visits"
          type="count"
          higherIsBetter
          current={ga4?.current.visits ?? null}
          previous={ga4?.previous?.visits ?? null}
          hasReport={!!ga4}
          subtext={ga4 ? "all sources, Analytics" : ga4Missing}
          tip="Visits to your site in the last 7 days."
        />
        <MetricCard
          label="Visits from AI"
          type="count"
          higherIsBetter
          current={ga4 ? ga4.current.aiVisits : null}
          previous={ga4?.previous ? ga4.previous.aiVisits : null}
          hasReport={!!ga4}
          subtext={aiSubtext}
          tip="Visits from AI chats."
          onClick={() => onNavigate("GEO")}
        />
      </div>
    </section>
  );
}

/* ---------- Search Console (real Google queries) ---------- */

type GscQueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

type GscQueriesResponse = {
  googleConnected: boolean;
  siteUrl: string | null;
  queries: GscQueryRow[] | null;
  totalTerms?: number;
  totalClicks?: number;
  totalImpressions?: number;
  hitCap?: boolean;
};

function SearchConsoleTab({ destination }: { destination: Destination }) {
  const [data, setData] = useState<GscQueriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { sort, onSort } = useTableSort({ key: "clicks", dir: "desc" });

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/gsc-queries?id=${destination.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (live && !d.message) setData(d);
      })
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [destination.id]);

  const rows = data?.queries ?? [];
  const sorted = sortRows(rows, sort, {
    clicks: (r) => r.clicks,
    impressions: (r) => r.impressions,
    ctr: (r) => r.ctr,
    position: (r) => r.position,
  });

  const totalTerms = data?.totalTerms ?? rows.length;
  const totalClicks = data?.totalClicks ?? rows.reduce((s, r) => s + r.clicks, 0);
  const totalImpr = data?.totalImpressions ?? rows.reduce((s, r) => s + r.impressions, 0);
  const plus = data?.hitCap ? "+" : "";

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-1 text-lg font-bold text-foreground">
          The real words people Googled
        </h2>
        <p className="text-sm text-muted">
          The actual terms that showed your site in Google. Last 28 days.
        </p>
      </section>

      {loading ? (
        <div className="glass rounded-2xl p-10 text-center text-sm text-muted">Loading…</div>
      ) : !data?.googleConnected ? (
        <ConnectPrompt
          destId={destination.id}
          title="Sign in with Google to see this"
          body="Connect Google Search Console and we’ll pull the real search terms people use to find you."
        />
      ) : !data.siteUrl ? (
        <ConnectPrompt
          destId={destination.id}
          title="No matching Search Console property"
          body={`Your Google account is connected, but none of its Search Console sites match ${hostOf(
            destination.url
          )}. Add this site in Search Console, then check Connections.`}
        />
      ) : rows.length === 0 ? (
        <div className="glass rounded-2xl p-10 text-center text-sm text-muted">
          No search data yet for {hostOf(destination.url)} in the last 28 days.
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile
              value={totalTerms.toLocaleString("en-US") + plus}
              label="search phrases"
              sub="phrases people typed where your site came up in their results"
            />
            <StatTile
              value={totalClicks.toLocaleString("en-US") + plus}
              label="clicks"
              sub="times someone actually clicked through to you"
            />
            <StatTile
              value={totalImpr.toLocaleString("en-US") + plus}
              label="impressions"
              sub="times your site was shown in someone's results"
            />
          </div>

          <Panel title={totalTerms > rows.length ? `Search terms · top ${rows.length} by clicks` : "Search terms"}>
            <div className="overflow-x-auto rounded-lg border border-edge">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-panel-2 text-left text-xs uppercase tracking-wider text-muted">
                    <th className="px-4 py-2.5 font-medium">Search term</th>
                    <th className="w-24 px-4 py-2.5 font-medium" title="Real clicks to your site">
                      <SortLabel label="Clicks" sortKey="clicks" sort={sort} onSort={onSort} align="right" />
                    </th>
                    <th className="w-28 px-4 py-2.5 font-medium" title="Times you appeared in results">
                      <SortLabel
                        label="Impressions"
                        sortKey="impressions"
                        sort={sort}
                        onSort={onSort}
                        align="right"
                      />
                    </th>
                    <th
                      className="w-24 px-4 py-2.5 font-medium"
                      title="Click-through rate: clicks ÷ impressions"
                    >
                      <SortLabel label="CTR" sortKey="ctr" sort={sort} onSort={onSort} align="right" />
                    </th>
                    <th className="w-28 px-4 py-2.5 font-medium" title="Your average Google position">
                      <SortLabel
                        label="Avg position"
                        sortKey="position"
                        sort={sort}
                        onSort={onSort}
                        align="right"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.query} className="border-t border-edge/60">
                      <td className="px-4 py-2.5 text-foreground/90">{r.query}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground/80">
                        {r.clicks.toLocaleString("en-US")}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground/80">
                        {r.impressions.toLocaleString("en-US")}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground/80">
                        {(r.ctr * 100).toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground/80">
                        {r.position.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted">
              Sorted by clicks. Click any column to re-sort. Top 100 terms shown.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}

function StatTile({ value, label, sub }: { value: string; label: string; sub: string }) {
  return (
    <div className="glass rounded-2xl p-5">
      <p className="text-3xl font-bold text-foreground">{value}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground/80">{label}</p>
      <p className="mt-0.5 text-xs text-muted">{sub}</p>
    </div>
  );
}

function ConnectPrompt({ destId, title, body }: { destId: string; title: string; body: string }) {
  const router = useRouter();
  return (
    <div className="glass rounded-2xl p-8 text-center">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{body}</p>
      <button
        onClick={() => router.push(`/workspace/settings?board=${destId}&section=connections`)}
        className="mt-4 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-black/80"
      >
        Open Connections
      </button>
    </div>
  );
}

/* ---------- Trend chart (Overview) ---------- */

type TrendMetricKey = "aiShareOfVoice" | "estVisits" | "avgGoogleRank" | "avgBingRank";

const TREND_METRICS: {
  key: TrendMetricKey;
  label: string;
  type: MetricType;
  higherIsBetter: boolean;
  get: (p: TrendPoint) => number | null;
}[] = [
  {
    key: "aiShareOfVoice",
    label: "AI Share of Voice",
    type: "percent",
    higherIsBetter: true,
    get: (p) => p.aiShareOfVoice,
  },
  {
    key: "estVisits",
    label: "Est. Google Visits",
    type: "count",
    higherIsBetter: true,
    get: (p) => p.estVisits,
  },
  {
    key: "avgGoogleRank",
    label: "Avg Google Rank",
    type: "rank",
    higherIsBetter: false,
    get: (p) => p.avgGoogleRank,
  },
  {
    key: "avgBingRank",
    label: "Avg Bing Rank",
    type: "rank",
    higherIsBetter: false,
    get: (p) => p.avgBingRank,
  },
];

function TrendChart({ trend }: { trend: TrendPoint[] }) {
  const [metricKey, setMetricKey] = useState<TrendMetricKey>("aiShareOfVoice");
  const metric = TREND_METRICS.find((m) => m.key === metricKey)!;

  // Only weeks that actually have a value for the chosen metric (some are null on legacy/partial runs).
  const points = trend
    .map((p) => ({ weekOf: p.weekOf, createdAt: p.createdAt, value: metric.get(p) }))
    .filter((p): p is { weekOf: string; createdAt: string; value: number } => p.value != null);

  return (
    <section className="glass rounded-2xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1 text-sm font-semibold uppercase tracking-wider text-muted">
          Trend over time
        </h2>
        <div className="flex flex-wrap gap-1">
          {TREND_METRICS.map((m) => {
            const active = m.key === metricKey;
            return (
              <button
                key={m.key}
                onClick={() => setMetricKey(m.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "bg-blue-100 text-foreground"
                    : "border border-edge bg-panel-2 text-muted hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {points.length === 0 ? (
        <EmptyChart
          message={
            trend.length === 0
              ? "Run a report to start the trend"
              : metric.key === "avgGoogleRank"
                ? "Not ranking in Google's top 100 yet — nothing to chart"
                : metric.key === "avgBingRank"
                  ? "Not ranking in Bing's top 50 yet — nothing to chart"
                  : "No value recorded for this metric yet"
          }
        />
      ) : (
        <>
          <LineChart points={points} metric={metric} />
          {points.length === 1 && (
            <p className="mt-3 text-xs text-muted">
              This is your starting point. Run a report in a future week and the dots connect into a
              trend line.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// Empty chart shell — same grid frame as LineChart, with a centered note instead of data.
function EmptyChart({ message }: { message: string }) {
  const W = 680;
  const H = 240;
  const padL = 52;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const plotH = H - padT - padB;
  const rows = [0, 0.5, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full" preserveAspectRatio="none" role="img">
      {rows.map((f, i) => (
        <line
          key={i}
          x1={padL}
          y1={padT + f * plotH}
          x2={W - padR}
          y2={padT + f * plotH}
          stroke="currentColor"
          className="text-black/10"
          strokeWidth={1}
        />
      ))}
      <text x={W / 2} y={padT + plotH / 2 + 4} textAnchor="middle" className="fill-muted text-[12px]">
        {message}
      </text>
    </svg>
  );
}

function LineChart({
  points,
  metric,
}: {
  points: { weekOf: string; createdAt: string; value: number }[];
  metric: (typeof TREND_METRICS)[number];
}) {
  const W = 680;
  const H = 240;
  const padL = 52;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const values = points.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // Pad the range a touch so the line never hugs the top/bottom edge; handle a flat series.
  const span = rawMax - rawMin || Math.abs(rawMax) || 1;
  const min = rawMin - span * 0.12;
  const max = rawMax + span * 0.12;
  const range = max - min || 1;

  const x = (i: number) => padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => padT + (1 - (v - min) / range) * plotH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.value)}`).join(" ");
  const areaPath = `${linePath} L ${x(points.length - 1)} ${padT + plotH} L ${x(0)} ${padT + plotH} Z`;

  const single = points.length === 1;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  const change = formatChange(metric.type, last, first);
  const improved =
    single || change.dir === "flat"
      ? null
      : metric.higherIsBetter
        ? change.dir === "up"
        : change.dir === "down";
  const stroke = improved === null ? "#737373" : improved ? "#16a34a" : "#e11d48";

  // Three horizontal gridlines with value labels.
  const ticks = [max, (max + min) / 2, min];

  const [hover, setHover] = useState<number | null>(null);

  return (
    <div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-2xl font-bold text-foreground">{formatValue(metric.type, last)}</span>
        {single ? (
          <span className="text-sm font-medium text-muted">this week</span>
        ) : (
          <span
            className={`flex items-center gap-0.5 text-sm font-medium ${
              improved === null ? "text-muted" : improved ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {change.dir !== "flat" && <span aria-hidden>{change.dir === "up" ? "▲" : "▼"}</span>}
            {change.text} since first week
          </span>
        )}
        <span className="text-xs text-muted">
          · {metric.higherIsBetter ? "higher is better" : "lower is better"}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 h-auto w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${metric.label} trend across ${points.length} weeks`}
      >
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={padL}
              y1={y(t)}
              x2={W - padR}
              y2={y(t)}
              stroke="currentColor"
              className="text-black/10"
              strokeWidth={1}
            />
            <text
              x={padL - 8}
              y={y(t) + 3}
              textAnchor="end"
              className="fill-muted text-[10px]"
            >
              {formatValue(metric.type, t)}
            </text>
          </g>
        ))}

        {!single && (
          <>
            <path d={areaPath} fill="url(#trendFill)" />
            <path
              d={linePath}
              fill="none"
              stroke={stroke}
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
          </>
        )}

        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r={hover === i ? 5 : 3.5} fill={stroke} />
            {/* wide invisible hit area for hover */}
            <rect
              x={x(i) - plotW / points.length / 2}
              y={padT}
              width={plotW / points.length}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
            {i % Math.ceil(points.length / 6) === 0 || i === points.length - 1 ? (
              <text
                x={x(i)}
                y={H - 12}
                textAnchor="middle"
                className="fill-muted text-[10px]"
              >
                {new Date(p.weekOf).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </text>
            ) : null}
          </g>
        ))}

        {hover !== null && (
          <g>
            <line
              x1={x(hover)}
              y1={padT}
              x2={x(hover)}
              y2={padT + plotH}
              stroke={stroke}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.5}
            />
            <text
              x={Math.min(Math.max(x(hover), padL + 30), W - padR - 30)}
              y={padT + 2}
              textAnchor="middle"
              className="fill-white text-[11px] font-semibold"
            >
              {formatValue(metric.type, points[hover].value)} · week of{" "}
              {new Date(points[hover].weekOf).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

/* ---------- AI Answers ---------- */

function AiAnswers({
  destination,
  current,
  previous,
  estimate,
  realData,
  onSave,
  saving,
}: {
  destination: Destination;
  current: Snapshot | null;
  previous: Snapshot | null;
  estimate: RunEstimate | null;
  realData: RealData | null;
  onSave: (next: Destination) => void;
  saving: boolean;
}) {
  const intent = current?.metrics.intentVisibility;
  const qv = current?.questionVisibility;
  const statusFor = (text: string) => qv?.find((q) => q.text === text);

  const boardEngines = destEngines(destination.engines);
  const engineNames = engineLabels(boardEngines);

  // The saved AI answers (stored by each report run — reading them is free).
  const [answers, setAnswers] = useState<StoredAnswers | null>(null);
  const [openQuestions, setOpenQuestions] = useState<Set<string>>(new Set());
  const questionsKey = destination.questions.map((q) => q.text).join("|");
  useEffect(() => {
    let live = true;
    fetch(`/api/answers?id=${destination.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (live) setAnswers(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination.id, questionsKey, current?.createdAt]);

  // Answers are stored in tracked-question order, so map each question back to its slot.
  const answerIndex = new Map(destination.questions.map((q, i) => [q.text, i]));
  const toggleOpen = (text: string) =>
    setOpenQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(text)) next.delete(text);
      else next.add(text);
      return next;
    });

  const addQuestion = (text: string, type: "Commercial" | "Informational") => {
    const t = text.trim();
    if (!t) return;
    if (destination.questions.some((q) => q.text.toLowerCase() === t.toLowerCase())) return;
    onSave({ ...destination, questions: [...destination.questions, { text: t, type }] });
  };
  const removeQuestion = (text: string) => {
    if (destination.questions.length <= 1) return; // keep at least one
    onSave({ ...destination, questions: destination.questions.filter((q) => q.text !== text) });
  };

  // Status as a sortable rank: named you (2) > answered but not named (1) > no AI answer (0) >
  // not measured yet (null → sinks to the bottom).
  const statusRank = (text: string): number | null => {
    const st = statusFor(text);
    if (!st) return null;
    if (!st.answered) return 0;
    return st.appeared ? 2 : 1;
  };

  const { sort, onSort } = useTableSort();
  const sortedQuestions = sortRows(destination.questions, sort, {
    type: (q) => q.type,
    status: (q) => statusRank(q.text),
  });

  return (
    <div className="space-y-6">
      <EngineBreakdownCard current={current} previous={previous} />

      <WhoAiRecommends destination={destination} answers={answers} />

      {intent ? (
        <IntentVisibilityCard intent={intent} />
      ) : (
        <Panel title="Mentions by question type">
          <p className="text-sm text-muted">
            Run a report on the Overview tab to see how often AI answers name you for buying
            questions vs research questions.
          </p>
        </Panel>
      )}

      <Panel title="Questions we track">
        <p className="text-sm text-muted">
          Every question we ask {engineNames} — and whether they named you. Click a question
          to read the actual answers
          {answers?.fetchedAt ? ` (saved ${relativeTime(answers.fetchedAt)})` : ""}.
        </p>

        <div className="mt-4 flex items-center gap-3 px-4 text-xs uppercase tracking-wider text-muted">
          <span className="flex-1">Question</span>
          <span className="w-28 text-right">
            <SortLabel label="Type" sortKey="type" sort={sort} onSort={onSort} align="right" />
          </span>
          <span className="w-28 text-right">
            <SortLabel label="Status" sortKey="status" sort={sort} onSort={onSort} align="right" />
          </span>
          <span className="w-5" />
        </div>

        <ul className="mt-2 space-y-2">
          {sortedQuestions.map((q) => {
            const st = statusFor(q.text);
            const isOpen = openQuestions.has(q.text);
            const idx = answerIndex.get(q.text);
            return (
              <li key={q.text} className="rounded-lg border border-edge bg-panel-2 px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toggleOpen(q.text)}
                    aria-expanded={isOpen}
                    title={`Read what ${engineNames} said`}
                    className="flex flex-1 items-center gap-2 text-left text-sm text-foreground/90 hover:text-foreground"
                  >
                    <span
                      aria-hidden
                      className={`shrink-0 text-[10px] text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}
                    >
                      ▶
                    </span>
                    {q.text}
                  </button>
                  <span className="flex w-28 justify-end">
                    <Tag type={q.type} />
                  </span>
                  <span className="flex w-28 justify-end">
                    {st ? (
                      <AppearancePill answered={st.answered} appeared={st.appeared} />
                    ) : (
                      <span className="text-xs text-muted">not measured</span>
                    )}
                  </span>
                  <RemoveBtn
                    onClick={() => removeQuestion(q.text)}
                    disabled={destination.questions.length <= 1}
                  />
                </div>
                {isOpen && (
                  <AnswerDetail
                    loaded={answers !== null}
                    perEngine={boardEngines.map((e) => ({
                      engine: e,
                      text: idx !== undefined ? (answers?.engines?.[e]?.[idx] ?? null) : null,
                    }))}
                    companyTerms={[destination.companyName, ...destination.aliases]}
                  />
                )}
              </li>
            );
          })}
        </ul>

        {estimate && (
          <p className="mt-4 text-xs text-muted">
            Each question is asked to {engineNames} on the weekly check — adding one costs
            about{" "}
            <span className="font-semibold text-foreground/90">
              {formatCost(estimate.perQuestionUsd)}
            </span>{" "}
            per week.
          </p>
        )}

        <AddQuestionRow onAdd={addQuestion} disabled={saving} />
      </Panel>

      <AiVisitorPages destId={destination.id} host={hostOf(destination.url)} realData={realData} />
    </div>
  );
}

/* ---------- Who AI recommends (from the saved answers, free) ---------- */

// Same whole-word matching as the scorer/highlighter, so counts agree with the green marks.
function isNamedIn(text: string, terms: string[]): boolean {
  const t = terms.map((s) => s.trim()).filter(Boolean);
  if (!t.length) return false;
  const re = new RegExp(`(?<![\\w])(${t.map(escapeRe).join("|")})(?![\\w])`, "i");
  return re.test(text);
}

function WhoAiRecommends({
  destination,
  answers,
}: {
  destination: Destination;
  answers: StoredAnswers | null;
}) {
  const allAnswers = Object.values(answers?.engines ?? {})
    .flatMap((list) => list ?? [])
    .filter((a): a is string => !!a);

  const rows = [
    {
      name: destination.companyName,
      isCompany: true,
      count: allAnswers.filter((a) =>
        isNamedIn(a, [destination.companyName, ...destination.aliases])
      ).length,
    },
    ...destination.competitors.map((c) => ({
      name: c.name,
      isCompany: false,
      count: allAnswers.filter((a) => isNamedIn(a, [c.name])).length,
    })),
  ].sort((a, b) => b.count - a.count);

  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <Panel title="Who AI recommends">
      <p className="text-sm text-muted">
        We run your questions to see how often AI answers name your competitor.
      </p>
      {allAnswers.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No saved AI answers yet — run a report and this fills in.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between text-sm">
                  <span
                    className={`truncate font-medium ${r.isCompany ? "text-accent2" : "text-foreground/90"}`}
                  >
                    {r.name} {r.isCompany && <span className="text-xs text-accent2">(you)</span>}
                  </span>
                  <span className="ml-2 tabular-nums text-foreground/80">
                    {r.count}
                    <span className="ml-1 text-xs text-muted">of {allAnswers.length} answers</span>
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/5">
                  <div
                    className={`h-full rounded-full ${r.isCompany ? "bg-accent" : "bg-black/15"}`}
                    style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------- Real AI visitors (GA4, free) ---------- */

function AiVisitorPages({
  destId,
  host,
  realData,
}: {
  destId: string;
  host: string;
  realData: RealData | null;
}) {
  const ga4 = realData?.ga4.data ?? null;
  const pages = ga4?.current.aiPages ?? [];
  const aiVisits = ga4?.current.aiVisits ?? 0;

  return (
    <Panel title="Visitors from AI">
      <p className="text-sm text-muted">The pages people landed on from AI chatbots.</p>

      {!ga4 ? (
        <div className="mt-4">
          <ConnectPrompt
            destId={destId}
            title="Connect Google Analytics to see this"
            body="Add this board's GA4 property in Connections and we'll show which pages your AI visitors land on — free, straight from your own Analytics."
          />
        </div>
      ) : aiVisits === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No visits from AI tools in the last 7 days yet — watch this grow as your AI visibility
          improves.
        </p>
      ) : pages.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {aiVisits} AI visit{aiVisits > 1 ? "s" : ""} this week, but Analytics didn&rsquo;t record
          which pages they landed on.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {pages.map((p) => (
            <li
              key={p.page}
              className="flex items-center gap-3 rounded-lg border border-edge bg-panel-2 px-4 py-2.5 text-sm"
            >
              <span className="min-w-0 flex-1 truncate font-medium text-foreground/90" title={p.page}>
                {p.page === "(not set)" ? (
                  <span className="font-normal text-muted">
                    Page not recorded{" "}
                    <InfoTip text="We couldn't tell which page this visitor landed on." />
                  </span>
                ) : p.page === "/" ? (
                  host
                ) : (
                  `${host}${p.page}`
                )}
              </span>
              <span className="shrink-0 text-xs text-muted">{p.sources.join(" · ")}</span>
              <span className="w-16 shrink-0 text-right tabular-nums text-foreground/80">
                {p.sessions}
                <span className="ml-1 text-xs text-muted">{p.sessions === 1 ? "visit" : "visits"}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AddQuestionRow({
  onAdd,
  disabled,
}: {
  onAdd: (text: string, type: "Commercial" | "Informational") => void;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const [type, setType] = useState<"Commercial" | "Informational">("Commercial");
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text, type);
    setText("");
  };
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-edge/60 pt-4">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="Add a question people ask…"
        className="min-w-[200px] flex-1 rounded-lg border border-edge bg-panel-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value as "Commercial" | "Informational")}
        className="rounded-lg border border-edge bg-panel-2 px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
      >
        <option value="Commercial">Commercial</option>
        <option value="Informational">Informational</option>
      </select>
      <button
        onClick={submit}
        disabled={disabled || !text.trim()}
        className="rounded-lg border border-edge bg-panel-2 px-4 py-2 text-sm font-medium text-foreground hover:border-accent disabled:opacity-50"
      >
        + Add
      </button>
    </div>
  );
}

/* ---------- Google ---------- */

function SearchTab({
  destination,
  current,
  estimate,
  onSave,
  saving,
}: {
  destination: Destination;
  current: Snapshot | null;
  estimate: RunEstimate | null;
  onSave: (next: Destination) => void;
  saving: boolean;
}) {
  const cur = current?.metrics;
  const ranks = current?.ranks;
  const rankFor = (kw: string) => ranks?.find((r) => (r.query ?? r.question) === kw);

  const [engine, setEngine] = useState<"google" | "bing">("google");

  const addKeyword = (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (destination.keywords.some((k) => k.toLowerCase() === t.toLowerCase())) return;
    onSave({ ...destination, keywords: [...destination.keywords, t] });
  };
  const removeKeyword = (kw: string) => {
    onSave({ ...destination, keywords: destination.keywords.filter((k) => k !== kw) });
  };

  const found = destination.keywords.filter((k) => rankFor(k)?.position != null).length;
  const foundBing = destination.keywords.filter((k) => rankFor(k)?.bingPosition != null).length;
  const hasMetrics = !!ranks?.some((r) => r.searchVolume != null || r.difficulty != null);
  const hasAi = !!ranks?.some((r) => r.aiOverview);
  const hasBingMetrics = !!ranks?.some(
    (r) => r.bingSearchVolume != null || r.bingCompetition != null
  );

  const aiRank = (kw: string): number | null => {
    const ai = rankFor(kw)?.aiOverview;
    if (!ai || !ai.present) return null;
    return ai.cited ? 2 : 1;
  };
  const { sort: gSort, onSort: onGSort } = useTableSort();
  const { sort: bSort, onSort: onBSort } = useTableSort();
  const googleKeywords = sortRows(destination.keywords, gSort, {
    searchVolume: (kw) => rankFor(kw)?.searchVolume ?? null,
    difficulty: (kw) => rankFor(kw)?.difficulty ?? null,
    ai: aiRank,
    position: (kw) => rankFor(kw)?.position ?? null,
  });
  const bingKeywords = sortRows(destination.keywords, bSort, {
    bingSearchVolume: (kw) => rankFor(kw)?.bingSearchVolume ?? null,
    bingCompetition: (kw) => rankFor(kw)?.bingCompetition ?? null,
    bingPosition: (kw) => rankFor(kw)?.bingPosition ?? null,
  });

  const googleColSpan = 3 + (hasMetrics ? 2 : 0) + (hasAi ? 1 : 0);
  const bingColSpan = 3 + (hasBingMetrics ? 2 : 0);

  const costNote = estimate && (
    <p className="mt-4 text-xs text-muted">
      One shared list — each phrase is checked on both Google and Bing every run. Adding one costs
      about{" "}
      <span className="font-semibold text-foreground/90">
        {formatCost(estimate.perKeywordUsd)}
      </span>{" "}
      per run.
    </p>
  );

  const emptyState = (
    <>
      <p className="text-sm text-muted">
        No search phrases yet. Add the short keywords people type into Google and Bing.
      </p>
      <div className="mt-4">
        <AddKeywordRow onAdd={addKeyword} disabled={saving} />
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {(["google", "bing"] as const).map((e) => (
          <button
            key={e}
            onClick={() => setEngine(e)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              engine === e
                ? "bg-blue-100 text-foreground"
                : "border border-edge bg-panel-2 text-muted hover:text-foreground"
            }`}
          >
            {e === "google" ? "Google" : "Bing"}
          </button>
        ))}
      </div>

      {engine === "google" ? (
        <>
          <AiOverviewCard
            hasReport={!!current}
            present={cur?.aiOverviewPresent}
            cited={cur?.aiOverviewCited}
          />

          <Panel
            title={`Google rankings by phrase · ranked for ${found} of ${destination.keywords.length}`}
          >
            {destination.keywords.length === 0 ? (
              emptyState
            ) : (
              <div className="overflow-x-auto rounded-lg border border-edge">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-panel-2 text-left text-xs uppercase tracking-wider text-muted">
                      <th className="px-4 py-2.5 font-medium">Search phrase</th>
                      {hasMetrics && (
                        <th
                          className="w-28 px-4 py-2.5 font-medium"
                          title="Monthly Google searches"
                        >
                          <SortLabel
                            label="Searches/mo"
                            sortKey="searchVolume"
                            sort={gSort}
                            onSort={onGSort}
                            align="right"
                          />
                        </th>
                      )}
                      {hasMetrics && (
                        <th
                          className="w-28 px-4 py-2.5 font-medium"
                          title="How hard it is to rank, 0–100"
                        >
                          <SortLabel
                            label="Difficulty"
                            sortKey="difficulty"
                            sort={gSort}
                            onSort={onGSort}
                            align="right"
                          />
                        </th>
                      )}
                      {hasAi && (
                        <th
                          className="w-28 px-4 py-2.5 font-medium"
                          title="Google's AI answer at the top of search"
                        >
                          <SortLabel
                            label="AI Overview"
                            sortKey="ai"
                            sort={gSort}
                            onSort={onGSort}
                            align="center"
                          />
                        </th>
                      )}
                      <th className="w-36 px-4 py-2.5 font-medium">
                        <SortLabel
                          label="Position"
                          sortKey="position"
                          sort={gSort}
                          onSort={onGSort}
                          align="right"
                        />
                      </th>
                      <th className="w-10 px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {googleKeywords.map((kw) => {
                      const r = rankFor(kw);
                      return (
                        <tr key={kw} className="border-t border-edge/60">
                          <td className="px-4 py-2.5 text-foreground/90">{kw}</td>
                          {hasMetrics && (
                            <td className="px-4 py-2.5 text-right tabular-nums text-foreground/80">
                              {r?.searchVolume != null
                                ? r.searchVolume.toLocaleString("en-US")
                                : "—"}
                            </td>
                          )}
                          {hasMetrics && (
                            <td className="px-4 py-2.5 text-right">
                              <DifficultyBadge value={r?.difficulty} />
                            </td>
                          )}
                          {hasAi && (
                            <td className="px-4 py-2.5 text-center">
                              <AiOverviewBadge ai={r?.aiOverview} />
                            </td>
                          )}
                          <td className="px-4 py-2.5 text-right">
                            {r ? (
                              <PositionBadge position={r.position} />
                            ) : (
                              <span className="text-xs text-muted">not measured yet</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <RemoveBtn onClick={() => removeKeyword(kw)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-edge/60">
                      <td colSpan={googleColSpan} className="px-4 py-3">
                        <AddKeywordRow onAdd={addKeyword} disabled={saving} />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {costNote}
          </Panel>

          <SearchConsoleTab destination={destination} />
        </>
      ) : (
        <>
          <section className="glass rounded-2xl p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Why Bing matters
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-foreground/80">
              Bing powers <span className="font-semibold text-foreground">ChatGPT&rsquo;s web search</span>{" "}
              and <span className="font-semibold text-foreground">Microsoft Copilot</span> — ranking well
              here directly shapes how AI assistants describe you, not just Bing itself.
            </p>
          </section>

          <Panel
            title={`Bing rankings by phrase · ranked for ${foundBing} of ${destination.keywords.length}`}
          >
            {destination.keywords.length === 0 ? (
              emptyState
            ) : (
              <div className="overflow-x-auto rounded-lg border border-edge">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-panel-2 text-left text-xs uppercase tracking-wider text-muted">
                      <th className="px-4 py-2.5 font-medium">Search phrase</th>
                      {hasBingMetrics && (
                        <th className="w-28 px-4 py-2.5 font-medium" title="Monthly Bing searches">
                          <SortLabel
                            label="Searches/mo"
                            sortKey="bingSearchVolume"
                            sort={bSort}
                            onSort={onBSort}
                            align="right"
                          />
                        </th>
                      )}
                      {hasBingMetrics && (
                        <th
                          className="w-28 px-4 py-2.5 font-medium"
                          title="How many advertisers compete for this phrase on Bing"
                        >
                          <SortLabel
                            label="Competition"
                            sortKey="bingCompetition"
                            sort={bSort}
                            onSort={onBSort}
                            align="right"
                          />
                        </th>
                      )}
                      <th className="w-36 px-4 py-2.5 font-medium">
                        <SortLabel
                          label="Position"
                          sortKey="bingPosition"
                          sort={bSort}
                          onSort={onBSort}
                          align="right"
                        />
                      </th>
                      <th className="w-10 px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {bingKeywords.map((kw) => {
                      const r = rankFor(kw);
                      return (
                        <tr key={kw} className="border-t border-edge/60">
                          <td className="px-4 py-2.5 text-foreground/90">{kw}</td>
                          {hasBingMetrics && (
                            <td className="px-4 py-2.5 text-right tabular-nums text-foreground/80">
                              {r?.bingSearchVolume != null
                                ? r.bingSearchVolume.toLocaleString("en-US")
                                : "—"}
                            </td>
                          )}
                          {hasBingMetrics && (
                            <td className="px-4 py-2.5 text-right">
                              <CompetitionBadge value={r?.bingCompetition} />
                            </td>
                          )}
                          <td className="px-4 py-2.5 text-right">
                            {r ? (
                              <PositionBadge position={r.bingPosition ?? null} notInTop={50} />
                            ) : (
                              <span className="text-xs text-muted">not measured yet</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <RemoveBtn onClick={() => removeKeyword(kw)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-edge/60">
                      <td colSpan={bingColSpan} className="px-4 py-3">
                        <AddKeywordRow onAdd={addKeyword} disabled={saving} />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {current && !hasBingMetrics && destination.keywords.length > 0 && (
              <p className="mt-4 text-xs text-muted">
                Bing search numbers will appear after your next report run.
              </p>
            )}
            {costNote}
          </Panel>
        </>
      )}
    </div>
  );
}

function AddKeywordRow({ onAdd, disabled }: { onAdd: (text: string) => void; disabled: boolean }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text);
    setText("");
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="Add a search phrase, e.g. “web3 security audit”"
        className="min-w-[200px] flex-1 rounded-lg border border-edge bg-panel-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
      />
      <button
        onClick={submit}
        disabled={disabled || !text.trim()}
        className="rounded-lg border border-edge bg-panel-2 px-4 py-2 text-sm font-medium text-foreground hover:border-accent disabled:opacity-50"
      >
        + Add
      </button>
    </div>
  );
}

function RemoveBtn({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Keep at least one" : "Remove"}
      aria-label="Remove"
      className="text-muted transition hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30"
    >
      ✕
    </button>
  );
}

/* ---------- AI Overview card + rank badges ---------- */

function AiOverviewCard({
  hasReport,
  present,
  cited,
}: {
  hasReport: boolean;
  present?: number;
  cited?: number;
}) {
  // Legacy snapshots have no AI Overview data — hide the card rather than show zeros.
  if (!hasReport || present === undefined) return null;

  return (
    <section className="glass rounded-2xl p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
        Google AI Overview
      </h2>
      <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="text-3xl font-bold text-foreground">
            {cited ?? 0} <span className="text-lg font-medium text-muted">of {present}</span>
          </p>
          <p className="mt-1 text-xs text-muted">AI answers that name you</p>
        </div>
        <p className="max-w-xl text-sm leading-relaxed text-foreground/80">
          Google now shows an AI-written answer at the top of search for{" "}
          <span className="font-semibold text-foreground">{present}</span> of your phrases. You&rsquo;re
          named as a source in <span className="font-semibold text-foreground">{cited ?? 0}</span> of
          them — that&rsquo;s the new spot to win, above the normal links.
        </p>
      </div>
    </section>
  );
}

function DifficultyBadge({ value }: { value?: number | null }) {
  if (value == null) return <span className="text-xs text-muted">—</span>;
  const tone =
    value <= 30
      ? "bg-emerald-100 text-emerald-600"
      : value <= 60
        ? "bg-amber-100 text-amber-700"
        : "bg-rose-100 text-rose-600";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
      {value}
    </span>
  );
}

function CompetitionBadge({ value }: { value?: number | null }) {
  if (value == null) return <span className="text-xs text-muted">—</span>;
  const [tone, label] =
    value <= 0.33
      ? ["bg-emerald-100 text-emerald-600", "Low"]
      : value <= 0.66
        ? ["bg-amber-100 text-amber-700", "Medium"]
        : ["bg-rose-100 text-rose-600", "High"];
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function AiOverviewBadge({ ai }: { ai?: { present: boolean; cited: boolean } }) {
  if (!ai || !ai.present) return <span className="text-xs text-muted">—</span>;
  if (ai.cited) {
    return (
      <span className="inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-600">
        Cites you
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-semibold text-foreground/70">
      Shown
    </span>
  );
}

function PositionBadge({ position, notInTop = 100 }: { position: number | null; notInTop?: number }) {
  if (position === null) {
    return <span className="text-xs text-muted">Not in top {notInTop}</span>;
  }
  const tone =
    position <= 3
      ? "bg-emerald-100 text-emerald-600"
      : position <= 10
        ? "bg-blue-100 text-accent"
        : position <= 30
          ? "bg-blue-100 text-accent"
          : "bg-black/5 text-foreground/70";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
      #{position}
    </span>
  );
}

/* ---------- Metric card + formatting ---------- */

function EnginePairCard({
  hasReport,
  per,
  prevPer,
  tip,
  onClick,
}: {
  hasReport: boolean;
  per?: Partial<Record<EngineId, number | null>>;
  prevPer?: Partial<Record<EngineId, number | null>>;
  tip?: string;
  onClick?: () => void;
}) {
  const clickProps = onClick
    ? {
        onClick,
        role: "button",
        tabIndex: 0,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        },
      }
    : {};
  const clickClass = onClick
    ? "cursor-pointer transition duration-150 hover:-translate-y-0.5 hover:border-accent hover:bg-black/[0.02] hover:shadow-md hover:shadow-black/5 focus:-translate-y-0.5 focus:border-accent focus:shadow-md focus:outline-none"
    : "";

  const engine = (value: number | null, previous: number | null) => {
    const change = value !== null && previous !== null ? formatChange("percent", value, previous) : null;
    const good = change === null || change.dir === "flat" ? null : change.dir === "up";
    return { text: value === null ? "—" : `${(value * 100).toFixed(1)}%`, change, good };
  };
  const engines = snapshotEngines(per);
  // Two chatbots read nicely as "X vs Y"; more than that gets a generic label.
  const label =
    engines.length && engines.length <= 2
      ? engines.map((e) => ENGINE_LABEL[e]).join(" vs ")
      : "By chatbot";

  if (!hasReport || engines.every((e) => per?.[e] == null)) {
    return (
      <div className={`glass rounded-2xl p-5 ${clickClass}`} {...clickProps}>
        <CardLabel label={label} tip={tip} />
        <p className="mt-2 text-3xl font-bold text-foreground">—</p>
        <p className="mt-1 text-xs text-muted">No report yet</p>
      </div>
    );
  }

  const column = (name: string, e: ReturnType<typeof engine>) => (
    <div key={name}>
      <p className="text-xs uppercase tracking-wider text-muted">{name}</p>
      <p className="mt-0.5 text-2xl font-bold text-foreground">{e.text}</p>
      {e.change && (
        <span
          className={`flex items-center gap-0.5 text-xs font-medium ${
            e.good === null ? "text-muted" : e.good ? "text-emerald-600" : "text-rose-600"
          }`}
        >
          {e.change.dir !== "flat" && <span aria-hidden>{e.change.dir === "up" ? "▲" : "▼"}</span>}
          {e.change.text}
        </span>
      )}
    </div>
  );

  return (
    <div className={`glass rounded-2xl p-5 ${clickClass}`} {...clickProps}>
      <CardLabel label={label} tip={tip} />
      <div className="mt-2 flex flex-wrap items-start gap-x-8 gap-y-3">
        {engines.map((id) =>
          column(ENGINE_LABEL[id], engine(per?.[id] ?? null, prevPer?.[id] ?? null))
        )}
      </div>
    </div>
  );
}

type MetricType = "percent" | "rank" | "count";

function formatCost(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function formatValue(type: MetricType, v: number): string {
  if (type === "percent") return `${(v * 100).toFixed(1)}%`;
  if (type === "rank") return v.toFixed(1);
  return Math.round(v).toLocaleString("en-US");
}

function formatChange(
  type: MetricType,
  cur: number,
  prev: number
): { text: string; dir: "up" | "down" | "flat" } {
  const d = cur - prev;
  const dir = d > 0 ? "up" : d < 0 ? "down" : "flat";
  if (type === "percent") {
    const pp = d * 100;
    return { text: `${pp >= 0 ? "+" : ""}${pp.toFixed(1)}pp`, dir };
  }
  if (type === "rank") {
    const r = Math.round(d * 10) / 10;
    const body = Number.isInteger(r) ? String(Math.abs(r)) : Math.abs(r).toFixed(1);
    return { text: `${r >= 0 ? "+" : "-"}${body}`, dir };
  }
  // count
  if (prev === 0) {
    return { text: `${d >= 0 ? "+" : ""}${Math.round(d).toLocaleString("en-US")}`, dir };
  }
  const pct = Math.round((d / prev) * 100);
  return { text: `${pct >= 0 ? "+" : ""}${pct}%`, dir };
}

function InfoTip({ text }: { text: string }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placement: "top" | "bottom" } | null>(null);

  const show = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(256, window.innerWidth * 0.8);
    const gap = 6;
    // Estimate tooltip height; flip below only when there isn't room above.
    const estHeight = 140;
    const placeBelow = r.top < estHeight + gap + 8;
    let left = r.left + r.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    setPos({
      top: placeBelow ? r.bottom + gap : r.top - gap,
      left,
      placement: placeBelow ? "bottom" : "top",
    });
  }, []);

  const hide = useCallback(() => setPos(null), []);

  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={btnRef}
        type="button"
        aria-label="More info"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="cursor-help text-[11px] leading-none text-muted transition hover:text-foreground"
      >
        ⓘ
      </button>
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            role="tooltip"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: Math.min(256, window.innerWidth * 0.8),
              transform: pos.placement === "top" ? "translateY(-100%)" : undefined,
            }}
            className="pointer-events-none z-[9999] rounded-lg border border-edge bg-panel-2 px-3 py-2 text-xs font-normal normal-case leading-relaxed tracking-normal text-foreground/90 shadow-xl"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}

function CardLabel({ label, tip }: { label: string; tip?: string }) {
  return (
    <p className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted">
      {label}
      {tip && <InfoTip text={tip} />}
    </p>
  );
}

function MetricCard({
  label,
  type,
  higherIsBetter,
  current,
  previous,
  hasReport,
  subtext,
  tip,
  onClick,
}: {
  label: string;
  type: MetricType;
  higherIsBetter: boolean;
  current: number | null;
  previous: number | null;
  hasReport: boolean;
  subtext?: string;
  tip?: string;
  onClick?: () => void;
}) {
  const clickProps = onClick
    ? {
        onClick,
        role: "button",
        tabIndex: 0,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        },
      }
    : {};
  const clickClass = onClick
    ? "cursor-pointer transition duration-150 hover:-translate-y-0.5 hover:border-accent hover:bg-black/[0.02] hover:shadow-md hover:shadow-black/5 focus:-translate-y-0.5 focus:border-accent focus:shadow-md focus:outline-none"
    : "";

  if (!hasReport || current === null) {
    return (
      <div className={`glass rounded-2xl p-5 ${clickClass}`} {...clickProps}>
        <CardLabel label={label} tip={tip} />
        <p className="mt-2 text-3xl font-bold text-foreground">—</p>
        <p className="mt-1 text-xs text-muted">{subtext ?? "No report yet"}</p>
      </div>
    );
  }

  const change = previous === null ? null : formatChange(type, current, previous);
  const good =
    change === null || change.dir === "flat"
      ? null
      : higherIsBetter
        ? change.dir === "up"
        : change.dir === "down";

  return (
    <div className={`glass rounded-2xl p-5 ${clickClass}`} {...clickProps}>
      <CardLabel label={label} tip={tip} />
      <p className="mt-2 text-3xl font-bold text-foreground">{formatValue(type, current)}</p>
      <div className="mt-1 flex items-center gap-1.5 text-xs">
        {change === null ? (
          <span className="text-muted">no prior</span>
        ) : (
          <span
            className={`flex items-center gap-0.5 font-medium ${
              good === null ? "text-muted" : good ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {change.dir !== "flat" && <span aria-hidden>{change.dir === "up" ? "▲" : "▼"}</span>}
            {change.text}
          </span>
        )}
        {subtext && <span className="text-muted">· {subtext}</span>}
      </div>
    </div>
  );
}

/* ---------- Intent visibility (AI Answers header) ---------- */

/** Plain read of which chatbot names you more — used inside the GEO tab. */
function engineInsight(per?: Partial<Record<EngineId, number | null>>): string {
  const measured = snapshotEngines(per)
    .map((e) => ({ e, v: per?.[e] ?? null }))
    .filter((x): x is { e: EngineId; v: number } => x.v !== null);
  if (!measured.length)
    return "Run a report to see how often each AI chatbot names you when it answers your questions.";
  if (measured.length === 1)
    return `Only ${ENGINE_LABEL[measured[0].e]} answered your questions this run.`;
  const best = measured.reduce((a, b) => (b.v > a.v ? b : a));
  const worst = measured.reduce((a, b) => (b.v < a.v ? b : a));
  if (Math.round((best.v - worst.v) * 100) < 10)
    return "You show up about evenly across your AI chatbots.";
  return `You're named most often in ${ENGINE_LABEL[best.e]} and least in ${ENGINE_LABEL[worst.e]} — ${ENGINE_LABEL[worst.e]} is where you have the most room to grow.`;
}

function EngineStat({
  name,
  value,
  previous,
  appearance,
}: {
  name: string;
  value: number | null;
  previous: number | null;
  appearance?: { appeared: number; answered: number };
}) {
  const change = value !== null && previous !== null ? formatChange("percent", value, previous) : null;
  const good = change === null || change.dir === "flat" ? null : change.dir === "up";
  return (
    <div className="rounded-xl border border-edge bg-panel-2 p-4">
      <p className="text-sm font-medium text-foreground/80">{name}</p>
      <p className="mt-1 text-4xl font-bold text-foreground">
        {value === null ? "—" : (value * 100).toFixed(1)}
        {value !== null && <span className="text-xl font-medium text-muted">%</span>}
      </p>
      {change ? (
        <span
          className={`mt-1 flex items-center gap-0.5 text-xs font-medium ${
            good === null ? "text-muted" : good ? "text-emerald-600" : "text-rose-600"
          }`}
        >
          {change.dir !== "flat" && <span aria-hidden>{change.dir === "up" ? "▲" : "▼"}</span>}
          {change.text} since last week
        </span>
      ) : (
        <span className="mt-1 block text-xs text-muted">
          {value === null ? "no answer this run" : "no prior week"}
        </span>
      )}
      {appearance && (
        <p className="mt-2 border-t border-edge pt-2 text-xs text-muted">
          {appearance.answered === 0
            ? "didn't answer this run"
            : `named you in ${appearance.appeared} of ${appearance.answered} ${
                appearance.answered === 1 ? "answer" : "answers"
              }`}
        </p>
      )}
    </div>
  );
}

/** ChatGPT vs Gemini vs all AI answers — share of voice + how many answers named you, per engine and combined. */
function EngineBreakdownCard({
  current,
  previous,
}: {
  current: Snapshot | null;
  previous: Snapshot | null;
}) {
  const cur = current?.metrics.aiPerEngine;
  const prev = previous?.metrics.aiPerEngine;
  const app = current?.metrics.aiEngineAppearance;
  const engines = snapshotEngines(cur);
  const measured = !!current && !!cur && engines.some((e) => cur[e] !== null);

  // Combined "all AI answers" column: flagship AI Share of Voice + how many questions any
  // engine named you on (one shared baseline across buying + research).
  const combinedShare = current?.metrics.aiShareOfVoice ?? null;
  const combinedPrev = previous?.metrics.aiShareOfVoice ?? null;
  const intent = current?.metrics.intentVisibility;
  const combinedAppearance = intent
    ? {
        appeared: intent.commercial.appeared + intent.informational.appeared,
        answered: intent.commercial.total + intent.informational.total,
      }
    : undefined;

  const change =
    combinedShare !== null && combinedPrev !== null
      ? formatChange("percent", combinedShare, combinedPrev)
      : null;
  const good = change === null || change.dir === "flat" ? null : change.dir === "up";

  return (
    <section className="glass rounded-2xl p-6">
      <h2 className="flex items-center gap-1 text-sm font-semibold uppercase tracking-wider text-muted">
        How AI answers name you
        <InfoTip text="The big number is your AI Share of Voice: across the chatbots you track, how often they name you versus competitors. Below, the same split per chatbot so you can see where you're stronger." />
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-foreground/80">{engineInsight(cur)}</p>

      {!measured ? (
        <p className="mt-4 text-sm text-muted">
          Run a report to see your share across your AI chatbots.
        </p>
      ) : (
        <>
          {/* ALL — the headline, every tracked chatbot blended */}
          <div className="mt-4 rounded-2xl border border-accent/40 bg-accent/5 p-5">
            <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-accent2">
              AI Share of Voice
              <InfoTip text="How often AI chatbots name your company when answering questions, versus competitors. Higher is better: it means AI recommends you more." />
            </p>
            <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1">
              <p className="text-5xl font-bold leading-none text-foreground">
                {combinedShare === null ? "—" : (combinedShare * 100).toFixed(1)}
                {combinedShare !== null && (
                  <span className="text-2xl font-medium text-muted">%</span>
                )}
              </p>
              {change && (
                <span
                  className={`flex items-center gap-0.5 pb-1 text-sm font-medium ${
                    good === null ? "text-muted" : good ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {change.dir !== "flat" && (
                    <span aria-hidden>{change.dir === "up" ? "▲" : "▼"}</span>
                  )}
                  {change.text} since last week
                </span>
              )}
            </div>
            {combinedAppearance && combinedAppearance.answered > 0 && (
              <p className="mt-2 text-sm text-foreground/70">
                named you in {combinedAppearance.appeared} of {combinedAppearance.answered} answers
              </p>
            )}
          </div>

          {/* Breakdown by chatbot */}
          <p className="mt-5 text-xs font-medium uppercase tracking-wider text-muted">
            Breakdown by chatbot
          </p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            {engines.map((e) => (
              <EngineStat
                key={e}
                name={ENGINE_LABEL[e]}
                value={cur?.[e] ?? null}
                previous={prev?.[e] ?? null}
                appearance={app?.[e]}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function IntentVisibilityCard({
  intent,
}: {
  intent: { commercial: IntentBucket; informational: IntentBucket };
}) {
  const total = intent.commercial.total + intent.informational.total;

  return (
    <section className="glass rounded-2xl p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
        Mentions by question type
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-foreground/80">
        See how you do on buying questions vs research questions.
      </p>

      {total === 0 && (
        <p className="mt-4 text-sm text-muted">
          No questions answered yet — run a report to see your buying vs research visibility.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <IntentStat label="Buying questions" bucket={intent.commercial} />
        <IntentStat label="Research questions" bucket={intent.informational} />
      </div>
    </section>
  );
}

function IntentStat({ label, tip, bucket }: { label: string; tip?: string; bucket: IntentBucket }) {
  return (
    <div className="rounded-xl border border-edge bg-panel-2 p-4">
      <p className="flex items-center gap-1 text-sm font-medium text-foreground/80">
        {label}
        {tip && <InfoTip text={tip} />}
      </p>
      {bucket.total === 0 ? (
        <p className="mt-2 text-sm text-muted">
          No {label.toLowerCase()} measured yet — add a few so we can track this.
        </p>
      ) : (
        <p className="mt-2 text-sm text-foreground/90">
          Named you in{" "}
          <span className="text-base font-semibold text-foreground">
            {bucket.appeared} of {bucket.total}
          </span>{" "}
          answered
        </p>
      )}
    </div>
  );
}

/* ---------- Saved AI answers (per-question drill-down) ---------- */

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Same whole-word matching as the report scorer, so what lights up here always agrees with the
// "Named you" pill. Longer terms first so "Remedy bug bounty" wins over "Remedy".
function highlightNames(text: string, companyTerms: string[]): React.ReactNode {
  const company = companyTerms
    .map((t) => t.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!company.length) return text;
  const re = new RegExp(`(?<![\\w])(${company.map(escapeRe).join("|")})(?![\\w])`, "gi");
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded bg-emerald-100 px-0.5 font-medium text-emerald-800">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function AnswerDetail({
  loaded,
  perEngine,
  companyTerms,
}: {
  loaded: boolean;
  perEngine: { engine: EngineId; text: string | null }[];
  companyTerms: string[];
}) {
  if (perEngine.every((p) => p.text == null)) {
    return (
      <div className="mt-3 border-t border-edge/60 pt-3">
        <p className="text-sm text-muted">
          {loaded
            ? "No saved answers for this question yet — they're stored when a report runs. Run a report on the Overview tab."
            : "Loading saved answers…"}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-3 border-t border-edge/60 pt-3">
      <p className="mb-2 flex items-center gap-1 text-xs text-muted">
        <span className="h-2 w-2 rounded-full bg-emerald-500" /> you
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {perEngine.map((p) => (
          <EngineAnswer
            key={p.engine}
            name={ENGINE_LABEL[p.engine]}
            text={p.text}
            companyTerms={companyTerms}
          />
        ))}
      </div>
    </div>
  );
}

function EngineAnswer({
  name,
  text,
  companyTerms,
}: {
  name: string;
  text: string | null;
  companyTerms: string[];
}) {
  return (
    <div className="rounded-lg border border-edge bg-panel px-3 py-2.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{name}</p>
      {text == null ? (
        <p className="mt-1 text-sm text-muted">No saved answer from {name} yet.</p>
      ) : text === "" ? (
        <p className="mt-1 text-sm text-muted">{name} didn&rsquo;t answer this question on the last check.</p>
      ) : (
        <p className="mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
          {highlightNames(text, companyTerms)}
        </p>
      )}
    </div>
  );
}

function AppearancePill({ answered, appeared }: { answered: boolean; appeared: boolean }) {
  if (!answered) return <span className="text-xs text-muted">no AI answer</span>;
  if (appeared)
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-600">
        Named you
      </span>
    );
  return (
    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-600">
      Not named
    </span>
  );
}

/* ---------- Competitors ---------- */

function Competitors({
  destination,
  current,
}: {
  destination: Destination;
  current: Snapshot | null;
}) {
  const traffic = current?.traffic;
  // Default to most traffic first; click a header to re-sort (and flip direction).
  const { sort, onSort } = useTableSort({ key: "estVisits", dir: "desc" });
  const rows = sortRows(traffic ?? [], sort, {
    estVisits: (t) => t.estVisits ?? null,
  });

  if (traffic && traffic.length) {
    const max = Math.max(1, ...traffic.map((t) => t.estVisits ?? 0));
    return (
      <div className="space-y-6">
      <Panel title="Who gets the most traffic from Google">
        <p className="mb-4 text-sm text-muted">
          Estimated monthly Google visits, you vs competitors
        </p>
        <div className="mb-2 flex items-center gap-3 pl-9 text-xs uppercase tracking-wider text-muted">
          <span className="flex-1">Company</span>
          <span className="w-32 text-right">
            <SortLabel
              label="Visits/mo"
              sortKey="estVisits"
              sort={sort}
              onSort={onSort}
              align="right"
            />
          </span>
        </div>
        <ul className="space-y-3">
          {rows.map((t, i) => (
            <li key={i} className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={favicon(t.domain)} alt="" className="h-6 w-6 shrink-0 rounded" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between text-sm">
                  <span
                    className={`truncate font-medium ${t.isCompany ? "text-accent2" : "text-foreground/90"}`}
                  >
                    {t.name} {t.isCompany && <span className="text-xs text-accent2">(you)</span>}
                  </span>
                  <span className="ml-2 tabular-nums text-foreground/80">
                    {t.estVisits != null ? t.estVisits.toLocaleString("en-US") : "—"}
                    <span className="ml-1 text-xs text-muted">/mo</span>
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/5">
                  <div
                    className={`h-full rounded-full ${t.isCompany ? "bg-accent" : "bg-black/15"}`}
                    style={{ width: `${Math.max(2, ((t.estVisits ?? 0) / max) * 100)}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <KeywordGapsPanel gaps={current?.keywordGaps} />
      </div>
    );
  }

  return (
    <Panel title="Competitors">
      {destination.competitors.length === 0 ? (
        <p className="text-sm text-muted">No competitors added.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            Run a report to compare estimated Google traffic across these companies.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {destination.competitors.map((c, i) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-lg border border-edge bg-panel-2 px-4 py-3"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={favicon(c.url)} alt="" className="h-6 w-6 rounded" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                  <p className="truncate text-xs text-muted">{hostOf(c.url)}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

/* ---------- Action Plan ---------- */

function ActionPlan({ current: _current }: { current: Snapshot | null }) {
  return (
    <Panel title="Action plan">
      <p className="text-sm text-muted">Coming soon.</p>
    </Panel>
  );
}

function NextMoves({ recs }: { recs: Recommendation[] }) {
  return (
    <Panel title="Your next moves">
      <ol className="space-y-3.5">
        {recs.map((r, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/5 text-xs font-semibold text-foreground/70">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-medium text-foreground/90">{r.title}</p>
              <p className="text-sm text-muted">{r.why}</p>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function KeywordGapsPanel({ gaps }: { gaps?: KeywordGap[] }) {
  // Default to the highest-impact gaps first (most monthly searches); columns re-sort on click.
  const { sort, onSort } = useTableSort({ key: "searchVolume", dir: "desc" });
  const sortedGaps = sortRows(gaps ?? [], sort, {
    searchVolume: (g) => g.searchVolume ?? null,
    competitor: (g) => g.competitor,
    competitorRank: (g) => g.competitorRank ?? null,
  });

  if (gaps === undefined) return null;

  if (gaps.length === 0) {
    return (
      <Panel title="Where competitors beat you">
        <p className="text-sm text-muted">
          Good news: no obvious gaps found. Your competitors aren&rsquo;t ranking high for phrases
          you&rsquo;re missing.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title={`Where competitors beat you — ${gaps.length} phrases`}>
      <p className="mb-4 text-sm text-muted">
        Phrases a competitor ranks in Google&rsquo;s top 10 for, but you don&rsquo;t rank for at all.
        Best opportunities first (most monthly searches).
      </p>
      <div className="overflow-x-auto rounded-lg border border-edge">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-panel-2 text-left text-xs uppercase tracking-wider text-muted">
              <th className="px-4 py-2.5 font-medium">Phrase to target</th>
              <th className="w-28 px-4 py-2.5 font-medium">
                <SortLabel
                  label="Searches/mo"
                  sortKey="searchVolume"
                  sort={sort}
                  onSort={onSort}
                  align="right"
                />
              </th>
              <th className="px-4 py-2.5 font-medium">
                <SortLabel label="Who ranks" sortKey="competitor" sort={sort} onSort={onSort} />
              </th>
              <th className="w-24 px-4 py-2.5 font-medium">
                <SortLabel
                  label="Their rank"
                  sortKey="competitorRank"
                  sort={sort}
                  onSort={onSort}
                  align="right"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedGaps.map((g, i) => (
              <tr key={i} className="border-t border-edge/60">
                <td className="px-4 py-2.5 text-foreground/90">{g.keyword}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-foreground/80">
                  {g.searchVolume != null ? g.searchVolume.toLocaleString("en-US") : "—"}
                </td>
                <td className="px-4 py-2.5 text-muted">{g.competitor}</td>
                <td className="px-4 py-2.5 text-right">
                  <PositionBadge position={g.competitorRank} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ---------- Sortable tables (shared) ---------- */
// One sort model for every table/list in the app. Click a column to sort by its value; click
// again to flip ascending/descending. The title column is never sortable. Missing values always
// sink to the bottom whichever way you sort, so blanks never crowd the top. Reuse for new tables:
// give each sortable column a key + an accessor, then render its header with <SortLabel>.

type SortDir = "asc" | "desc";
type SortState = { key: string; dir: SortDir } | null;
type Accessors<T> = Record<string, (row: T) => number | string | null | undefined>;

function useTableSort(initial: SortState = null) {
  const [sort, setSort] = useState<SortState>(initial);
  const onSort = useCallback((key: string) => {
    setSort((prev) =>
      prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }, []);
  return { sort, onSort };
}

function sortRows<T>(rows: T[], sort: SortState, accessors: Accessors<T>): T[] {
  if (!sort) return rows;
  const acc = accessors[sort.key];
  if (!acc) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = acc(a);
    const vb = acc(b);
    const aBlank = va === null || va === undefined || va === "";
    const bBlank = vb === null || vb === undefined || vb === "";
    if (aBlank && bBlank) return 0;
    if (aBlank) return 1; // blanks always last, regardless of direction
    if (bBlank) return -1;
    const cmp =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb));
    return cmp * dir;
  });
}

function SortCaret({ active, dir }: { active: boolean; dir?: SortDir }) {
  return (
    <span
      className={`text-[9px] leading-none ${active ? "text-accent2" : "text-muted/40"}`}
      aria-hidden
    >
      {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
    </span>
  );
}

/** A clickable sort header. Works inside a <th> or a plain header row (lists). */
function SortLabel({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  align?: "left" | "right" | "center";
}) {
  const active = sort?.key === sortKey;
  const justify =
    align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`flex w-full items-center gap-1 uppercase tracking-wider transition hover:text-foreground ${justify} ${
        active ? "text-foreground" : ""
      }`}
    >
      {label}
      <SortCaret active={active} dir={sort?.dir} />
    </button>
  );
}

/* ---------- UI bits ---------- */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-2xl p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Tag({ type }: { type: "Commercial" | "Informational" }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${
        type === "Commercial"
          ? "bg-blue-100 text-accent"
          : "bg-blue-100 text-accent"
      }`}
    >
      {type}
    </span>
  );
}

