import { promises as fs } from "fs";
import path from "path";
import type { Destination } from "./store";
import {
  llmAnswer,
  serpAnalyze,
  serpAnalyzeBing,
  keywordMetrics,
  bingKeywordMetrics,
  trafficEstimate,
  rankedKeywords,
  hostOf,
  type BingKeywordMetric,
} from "./dataforseo";
import { getSpendLog } from "./spend";
import { recommendActions, type Recommendation } from "./ai";
import { destEngines, ENGINE_UNIT_COST, type EngineId } from "./engines";

export type RankRow = {
  query: string;
  position: number | null;
  bingPosition?: number | null; // organic position on Bing (null = not in top 50, undefined = not measured)
  aiOverview?: { present: boolean; cited: boolean };
  searchVolume?: number | null; // monthly Google searches for this phrase
  difficulty?: number | null; // 0..100, how hard it is to rank (higher = harder)
  bingSearchVolume?: number | null; // monthly Bing searches (Microsoft Ads data)
  bingCompetition?: number | null; // 0..1 advertiser competition on Bing (higher = more contested)
};

export type TrafficRow = {
  name: string;
  domain: string;
  isCompany: boolean;
  estVisits: number | null; // estimated monthly organic visits from Google
  keywordCount: number | null; // how many Google keywords the domain ranks for
};

export type KeywordGap = {
  keyword: string;
  searchVolume: number | null;
  competitor: string; // competitor name that ranks for it
  competitorRank: number; // their Google position
};

// How often an AI answer names the company, for one intent group of questions.
export type IntentBucket = {
  total: number; // questions of this intent that an AI actually answered
  appeared: number; // of those, how many named the company
  rate: number | null; // appeared / total, or null when total is 0
};

// One tracked question's AI-answer outcome this run (drives the "which ones am I missing" drill-down).
export type QuestionVisibility = {
  text: string;
  type: "Commercial" | "Informational";
  answered: boolean;
  appeared: boolean;
};

export type Snapshot = {
  id: string;
  destId: string;
  subject?: string; // the destination's website host at run time; identifies WHICH company this is about
  createdAt: string;
  weekOf: string; // YYYY-MM-DD (Monday of the run week)
  costUsd?: number; // data spend this run added (near-zero on cached same-week re-runs)
  metrics: {
    aiShareOfVoice: number | null; // 0..1, average of per-engine shares
    // Keyed by engine id (chatgpt/gemini/…) — only the engines this run actually asked.
    aiPerEngine: Partial<Record<EngineId, number | null>>;
    // Per-engine "named you in X of Y answered" counts, for the GEO breakdown.
    aiEngineAppearance?: Partial<Record<EngineId, { appeared: number; answered: number }>>;
    // Appearance rate split by question intent: are we visible where buyers ask?
    intentVisibility: { commercial: IntentBucket; informational: IntentBucket };
    avgGoogleRank: number | null; // average position across ranked queries, lower is better
    rankedCount: number;
    avgBingRank: number | null; // average Bing position across phrases that rank, lower is better
    bingRankedCount: number; // how many phrases rank in Bing's top 50
    totalQueries: number;
    aiOverviewPresent: number; // how many phrases trigger a Google AI Overview
    aiOverviewCited: number; // how many of those AI Overviews cite the company
    estVisits: number | null; // estimated monthly organic Google visits (DataForSEO)
    realVisits: number | null; // GA4 — null until connected
    googleImpressions: number | null; // GSC — null until connected
  };
  ranks: RankRow[];
  questionVisibility?: QuestionVisibility[]; // per-question AI-answer outcome this run
  traffic?: TrafficRow[]; // company + competitors, by estimated Google traffic
  keywordGaps?: KeywordGap[]; // phrases competitors rank for that the company doesn't
  recommendations?: Recommendation[]; // AI-written next moves, grounded in this run's data
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Count whole-word, case-insensitive occurrences of any of `terms` in `text`. */
function countMentions(text: string, terms: string[]): number {
  const cleaned = terms.map((t) => t.trim()).filter(Boolean);
  if (!cleaned.length) return 0;
  const re = new RegExp(`(?<![\\w])(?:${cleaned.map(escapeRe).join("|")})(?![\\w])`, "gi");
  return (text.match(re) ?? []).length;
}

/** Run `fn` over `items` with at most `limit` in flight at once. Preserves order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function mondayOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay(); // 0 Sun..6 Sat
  const diff = (day === 0 ? -6 : 1) - day;
  x.setUTCDate(x.getUTCDate() + diff);
  return x.toISOString().slice(0, 10);
}

type EngineResult = {
  share: number | null;
  // Aligned to dest.questions order: did we get an answer, and were we named in it?
  perQuestion: { answered: boolean; appeared: boolean }[];
};

/**
 * Ask one AI engine every tracked question (the paid step). Order matches dest.questions.
 * A failed question comes back as "" (scored as "no answer", not "not named") and is counted.
 */
async function engineAnswers(
  engine: EngineId,
  dest: Destination
): Promise<{ answers: string[]; failed: number }> {
  let failed = 0;
  const answers = await mapLimit(dest.questions, 6, (q) =>
    llmAnswer(engine, q.text).catch(() => {
      failed++;
      return "";
    })
  );
  return { answers, failed };
}

/** Score raw answers against current company/competitor names (free — no API calls). */
function scoreAnswers(answers: string[], dest: Destination): EngineResult {
  const companyTerms = [dest.companyName, ...dest.aliases];
  const competitorTerms = dest.competitors.map((c) => c.name).filter(Boolean);

  let company = 0;
  let competitor = 0;
  let answered = 0;
  const perQuestion = answers.map((answer) => {
    if (!answer) return { answered: false, appeared: false };
    answered++;
    const companyHits = countMentions(answer, companyTerms);
    company += companyHits;
    competitor += countMentions(answer, competitorTerms);
    return { answered: true, appeared: companyHits > 0 };
  });

  if (answered === 0) return { share: null, perQuestion };
  const total = company + competitor;
  return { share: total === 0 ? 0 : company / total, perQuestion };
}

/**
 * Estimated Google traffic for the company + competitors, and the "keyword gap":
 * phrases competitors rank in Google's top 10 for that the company doesn't rank for at all.
 */
async function competitorIntel(dest: Destination): Promise<{
  estVisits: number | null;
  traffic: TrafficRow[];
  keywordGaps: KeywordGap[];
  failed?: boolean; // some pull failed — don't cache this result
}> {
  const companyDomain = hostOf(dest.url);
  const competitors = dest.competitors
    .map((c) => ({ name: c.name, domain: hostOf(c.url) }))
    .filter((c) => c.domain && c.domain !== companyDomain)
    .slice(0, 6);

  const allDomains = [companyDomain, ...competitors.map((c) => c.domain)];

  let failed = false;
  let companyKwsFailed = false;
  const [trafficByDomain, companyKws, competitorKwLists] = await Promise.all([
    trafficEstimate(allDomains).catch(() => {
      failed = true;
      return {} as Awaited<ReturnType<typeof trafficEstimate>>;
    }),
    rankedKeywords(companyDomain, 200).catch(() => {
      failed = companyKwsFailed = true;
      return [];
    }),
    mapLimit(competitors, 4, (c) =>
      rankedKeywords(c.domain, 200).catch(() => {
        failed = true;
        return [];
      })
    ),
  ]);

  const traffic: TrafficRow[] = allDomains.map((domain, i) => ({
    name: i === 0 ? dest.companyName : competitors[i - 1].name,
    domain,
    isCompany: i === 0,
    estVisits: trafficByDomain[domain]?.estVisits ?? null,
    keywordCount: trafficByDomain[domain]?.keywordCount ?? null,
  }));

  const companyOwns = new Set(companyKws.map((k) => k.keyword.toLowerCase()));

  // Brand tokens (competitor names + domain labels) so we can drop "trail of bits"-style
  // brand searches — they're competitors' own names, not phrases the company should target.
  const collapse = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const brandTokens = competitors
    .flatMap((c) => [collapse(c.name), collapse(c.domain.split(".")[0])])
    .filter((t) => t.length >= 4);
  const isBrandTerm = (keyword: string) => {
    const k = collapse(keyword);
    return brandTokens.some((t) => k.includes(t) || t.includes(k));
  };

  const gapByKeyword = new Map<string, KeywordGap>();
  competitorKwLists.forEach((list, idx) => {
    const competitorName = competitors[idx].name;
    for (const kw of list) {
      const key = kw.keyword.toLowerCase();
      if (companyOwns.has(key)) continue; // company already ranks — not a gap
      if (kw.rank === null || kw.rank > 10) continue; // only strong competitor positions
      if (isBrandTerm(kw.keyword)) continue; // skip competitor brand-name searches
      const existing = gapByKeyword.get(key);
      const better = !existing || (kw.searchVolume ?? 0) > (existing.searchVolume ?? 0);
      if (better) {
        gapByKeyword.set(key, {
          keyword: kw.keyword,
          searchVolume: kw.searchVolume,
          competitor: competitorName,
          competitorRank: kw.rank,
        });
      }
    }
  });

  const keywordGaps = [...gapByKeyword.values()]
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, 25);

  return {
    estVisits: trafficByDomain[companyDomain]?.estVisits ?? null,
    traffic,
    // Without the company's own keyword list every competitor phrase would look like a "gap".
    keywordGaps: companyKwsFailed ? [] : keywordGaps,
    failed,
  };
}

type IntelResult = Omit<Awaited<ReturnType<typeof competitorIntel>>, "failed">;
type IntelCacheEntry = { fetchedAt: string; sig: string; data: IntelResult };

const INTEL_CACHE = path.join(process.cwd(), "data", "intel-cache.json");
const LLM_CACHE = path.join(process.cwd(), "data", "llm-cache.json");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Competitor traffic + ranked keywords barely move day to day, but they're the priciest part
// of a run (a 200-keyword pull per competitor). Cache per destination and only refetch when the
// data is over a week old or the competitor list changed — so re-running the report is cheap.
function competitorSig(dest: Destination): string {
  const comps = dest.competitors.map((c) => hostOf(c.url)).filter(Boolean).sort();
  return [hostOf(dest.url), ...comps].join("|");
}

async function readIntelCache(): Promise<Record<string, IntelCacheEntry>> {
  try {
    return JSON.parse(await fs.readFile(INTEL_CACHE, "utf8"));
  } catch {
    return {};
  }
}

async function cachedCompetitorIntel(dest: Destination): Promise<IntelResult> {
  const sig = competitorSig(dest);
  let cache = await readIntelCache();
  const hit = cache[dest.id];
  if (hit && hit.sig === sig && Date.now() - new Date(hit.fetchedAt).getTime() < WEEK_MS) {
    return hit.data;
  }
  const { failed, ...data } = await competitorIntel(dest);
  // Only cache a clean pull — a failure must not lock in empty lists for a week.
  if (failed) return data;
  cache = await readIntelCache(); // re-read: another board may have written meanwhile
  cache[dest.id] = { fetchedAt: new Date().toISOString(), sig, data };
  try {
    await fs.mkdir(path.dirname(INTEL_CACHE), { recursive: true });
    await fs.writeFile(INTEL_CACHE, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    // cache write is best-effort
  }
  return data;
}

type LlmCacheEntry = { fetchedAt: string; sig: string; answers: string[] };

// LLM answers are the priciest part of a run (~$0.50 Gemini + ~$0.18 ChatGPT) and an AI's view
// of a company barely shifts day to day. Cache each engine's raw answers per destination for a
// week and reuse them on re-runs. Scoring stays live, so company/competitor name edits are still
// reflected. Refetch only when a week passes or the question list changes.
function questionsSig(dest: Destination): string {
  return dest.questions.map((q) => q.text.trim().toLowerCase()).join("|");
}

async function readLlmCache(): Promise<Record<string, LlmCacheEntry>> {
  try {
    return JSON.parse(await fs.readFile(LLM_CACHE, "utf8"));
  } catch {
    return {};
  }
}

// A report fetches both engines at once, so their cache writes race on this one file. Without
// serialization each reads the same starting state and clobbers the other's key — only one engine
// would persist, and the other would re-fetch (and re-bill) on every run. This chain forces the
// read-modify-write steps to run one at a time, in order (same fix as spend.ts).
let llmCacheChain: Promise<void> = Promise.resolve();

function writeLlmCacheEntry(key: string, entry: LlmCacheEntry): Promise<void> {
  llmCacheChain = llmCacheChain.then(async () => {
    try {
      const cache = await readLlmCache();
      cache[key] = entry;
      await fs.mkdir(path.dirname(LLM_CACHE), { recursive: true });
      await fs.writeFile(LLM_CACHE, JSON.stringify(cache, null, 2), "utf8");
    } catch {
      // cache write is best-effort
    }
  });
  return llmCacheChain;
}

export type StoredAnswers = {
  // Per engine, aligned to dest.questions order; null when no cached answers match the
  // current question list. Only the board's selected engines appear as keys.
  engines: Partial<Record<EngineId, string[] | null>>;
  fetchedAt: string | null; // when the answers were fetched (they refresh weekly)
};

/** The saved AI answers for this destination's current questions — a free read, no API calls. */
export async function cachedAnswersFor(dest: Destination): Promise<StoredAnswers> {
  const sig = questionsSig(dest);
  const cache = await readLlmCache();
  const engines: StoredAnswers["engines"] = {};
  let fetchedAt: string | null = null;
  for (const engine of destEngines(dest.engines)) {
    const hit = cache[`${dest.id}:${engine}`];
    const ok = hit && hit.sig === sig ? hit : null;
    engines[engine] = ok?.answers ?? null;
    fetchedAt = fetchedAt ?? ok?.fetchedAt ?? null;
  }
  return { engines, fetchedAt };
}

async function cachedEngineAnswers(
  engine: EngineId,
  dest: Destination
): Promise<{ answers: string[]; failed: number }> {
  const sig = questionsSig(dest);
  const key = `${dest.id}:${engine}`;
  const hit = (await readLlmCache())[key];
  if (hit && hit.sig === sig && Date.now() - new Date(hit.fetchedAt).getTime() < WEEK_MS) {
    return { answers: hit.answers, failed: 0 };
  }
  // Fetch outside the write lock so both engines still run in parallel; only the writes serialize.
  const result = await engineAnswers(engine, dest);
  // Only cache a complete set — blank answers from a failed call must not stick for a week.
  if (result.failed === 0) {
    await writeLlmCacheEntry(key, { fetchedAt: new Date().toISOString(), sig, answers: result.answers });
  }
  return result;
}

// Bing search volumes barely move week to week but the call is comparatively pricey (~$0.09 for
// the whole list), so cache them per destination for a week, keyed by the phrase list.
type BingVolCacheEntry = {
  fetchedAt: string;
  sig: string;
  volumes: Record<string, BingKeywordMetric>;
};

const BINGVOL_CACHE = path.join(process.cwd(), "data", "bing-volume-cache.json");

function bingVolSig(queries: string[]): string {
  return queries.map((q) => q.trim().toLowerCase()).sort().join("|");
}

async function readBingVolCache(): Promise<Record<string, BingVolCacheEntry>> {
  try {
    return JSON.parse(await fs.readFile(BINGVOL_CACHE, "utf8"));
  } catch {
    return {};
  }
}

async function cachedBingMetrics(
  destId: string,
  queries: string[]
): Promise<Record<string, BingKeywordMetric>> {
  const sig = bingVolSig(queries);
  const hit = (await readBingVolCache())[destId];
  if (hit && hit.sig === sig && Date.now() - new Date(hit.fetchedAt).getTime() < WEEK_MS) {
    return hit.volumes;
  }
  // Only cache a successful fetch — a failure must not lock in an empty result for a week.
  const volumes = await bingKeywordMetrics(queries);
  try {
    const cache = await readBingVolCache();
    cache[destId] = { fetchedAt: new Date().toISOString(), sig, volumes };
    await fs.mkdir(path.dirname(BINGVOL_CACHE), { recursive: true });
    await fs.writeFile(BINGVOL_CACHE, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    // cache write is best-effort
  }
  return volumes;
}

async function bingVolCacheWarm(destId: string, queries: string[]): Promise<boolean> {
  const sig = bingVolSig(queries);
  const hit = (await readBingVolCache())[destId];
  return !!(hit && hit.sig === sig && Date.now() - new Date(hit.fetchedAt).getTime() < WEEK_MS);
}

// Average USD per DataForSEO call, from observed spend. Used only to *estimate* a run's cost up
// front so the user sees the dollar commitment before clicking. Actual cost is recorded on costUsd.
export const UNIT_COST = {
  ...ENGINE_UNIT_COST, // per-question cost of each AI chatbot (chatgpt/gemini/perplexity/claude)
  serp: 0.0101,
  serpBing: 0.0101, // Bing organic SERP, priced like the Google one
  keywordOverview: 0.0111,
  bingVolume: 0.09, // one call for the whole phrase list, cached weekly
  trafficEstimate: 0.0107,
  rankedKeywords: 0.0253,
};

async function llmCacheWarm(engine: EngineId, dest: Destination): Promise<boolean> {
  const sig = questionsSig(dest);
  try {
    const cache = JSON.parse(await fs.readFile(LLM_CACHE, "utf8")) as Record<string, LlmCacheEntry>;
    const hit = cache[`${dest.id}:${engine}`];
    return !!(hit && hit.sig === sig && Date.now() - new Date(hit.fetchedAt).getTime() < WEEK_MS);
  } catch {
    return false;
  }
}

async function intelCacheWarm(dest: Destination): Promise<boolean> {
  const sig = competitorSig(dest);
  try {
    const cache = JSON.parse(
      await fs.readFile(INTEL_CACHE, "utf8")
    ) as Record<string, IntelCacheEntry>;
    const hit = cache[dest.id];
    return !!(hit && hit.sig === sig && Date.now() - new Date(hit.fetchedAt).getTime() < WEEK_MS);
  } catch {
    return false;
  }
}

function competitorCount(dest: Destination): number {
  const companyDomain = hostOf(dest.url);
  return dest.competitors
    .map((c) => hostOf(c.url))
    .filter((d) => d && d !== companyDomain)
    .slice(0, 6).length;
}

export type RunEstimate = {
  totalUsd: number; // estimated data spend the next run will add
  firstOfWeek: boolean; // true when the weekly AI/competitor refresh will run (the pricey path)
  perQuestionUsd: number; // added cost of one more tracked question, per weekly check
  perKeywordUsd: number; // added cost of one more tracked phrase, charged every run
};

// Price the *next* run for this destination, accounting for what's still cached. Adding a question
// changes the question signature, so the LLM cache misses and the estimate jumps to a full run —
// which is exactly the commitment we want to surface before the click.
export async function estimateNextRun(dest: Destination): Promise<RunEstimate> {
  const nQuestions = dest.questions.length;
  const queries = dest.keywords?.length ? dest.keywords : dest.questions.map((q) => q.text);
  const nQueries = queries.length;
  const nComp = competitorCount(dest);
  const engines = destEngines(dest.engines);

  const [engineWarm, intelWarm, bingVolWarm] = await Promise.all([
    Promise.all(engines.map((e) => llmCacheWarm(e, dest))),
    intelCacheWarm(dest),
    bingVolCacheWarm(dest.id, queries),
  ]);

  // Google + Bing rankings both run every time (one SERP call each, per phrase).
  let total = nQueries * (UNIT_COST.serp + UNIT_COST.serpBing) + UNIT_COST.keywordOverview;
  engines.forEach((e, i) => {
    if (!engineWarm[i]) total += nQuestions * ENGINE_UNIT_COST[e];
  });
  if (!intelWarm) total += UNIT_COST.trafficEstimate + (1 + nComp) * UNIT_COST.rankedKeywords;
  if (!bingVolWarm) total += UNIT_COST.bingVolume;

  // One more question is asked to every selected engine each weekly refresh (and adds Google +
  // Bing rank checks too, but only when there's no separate phrase list, since otherwise phrases
  // drive SERP).
  const perQuestionUsd =
    engines.reduce((s, e) => s + ENGINE_UNIT_COST[e], 0) +
    (dest.keywords?.length ? 0 : UNIT_COST.serp + UNIT_COST.serpBing);

  return {
    totalUsd: Math.round(total * 100) / 100,
    firstOfWeek: engineWarm.some((w) => !w) || !intelWarm || !bingVolWarm,
    perQuestionUsd: Math.round(perQuestionUsd * 100) / 100,
    perKeywordUsd: Math.round((UNIT_COST.serp + UNIT_COST.serpBing) * 100) / 100,
  };
}

export type RunCosts = {
  weeklyUsd: number; // full weekly refresh: Google rankings + AI answers + competitor intel
  manualUsd: number; // a same-week re-run you trigger yourself: Google rankings only (AI/intel cached)
};

// Price a destination's runs purely from its counts, with no cache reads — used to show the cost
// on the setup form before anything is saved. Recomputes whenever questions/phrases/competitors
// change, so the dollar figure tracks the list the user is editing.
export function estimateRunCosts(input: {
  url: string;
  questions: { text: string }[];
  keywords?: string[];
  competitors: { url: string }[];
  engines?: string[];
}): RunCosts {
  const nQuestions = input.questions.filter((q) => q.text.trim() !== "").length;
  const nKeywords = (input.keywords ?? []).filter((k) => k.trim() !== "").length;
  const nQueries = nKeywords || nQuestions;
  const companyDomain = hostOf(input.url);
  const nComp = input.competitors
    .map((c) => hostOf(c.url))
    .filter((d) => d && d !== companyDomain)
    .slice(0, 6).length;

  // Search rankings = Google + Bing SERP per phrase (both run every time), plus keyword metrics.
  const enginesUsd = destEngines(input.engines).reduce((s, e) => s + ENGINE_UNIT_COST[e], 0);
  const rankingsOnly =
    nQueries * (UNIT_COST.serp + UNIT_COST.serpBing) + UNIT_COST.keywordOverview;
  const aiAndIntel =
    nQuestions * enginesUsd +
    UNIT_COST.trafficEstimate +
    (1 + nComp) * UNIT_COST.rankedKeywords +
    UNIT_COST.bingVolume;

  return {
    weeklyUsd: Math.round((rankingsOnly + aiAndIntel) * 100) / 100,
    manualUsd: Math.round(rankingsOnly * 100) / 100,
  };
}

export async function runReport(dest: Destination): Promise<Snapshot> {
  // What this run actually costs = the data spend it adds. Cached engine/competitor calls don't
  // hit the API, so a same-week re-run reads near-zero here. (post() awaits recordSpend, so by the
  // time every fetch below resolves the spend log already reflects them.)
  const spendBefore = (await getSpendLog()).totalUsd;

  // Short keyword phrases drive Google rank; falls back to questions if no keywords set.
  const queries = dest.keywords?.length ? dest.keywords : dest.questions.map((q) => q.text);
  const engines = destEngines(dest.engines);

  // Run AI Share of Voice (every selected engine), Google SERP, keyword metrics, and competitor
  // intel all at once — they're independent.
  let serpFailed = 0;
  const [engineResults, serp, bingSerp, metricsByKw, bingMetricsByKw, intel] =
    await Promise.all([
      Promise.all(engines.map((e) => cachedEngineAnswers(e, dest))),
      mapLimit(queries, 6, async (query) => ({
        query,
        ...(await serpAnalyze(query, dest.url).catch(() => {
          serpFailed++;
          return { rank: null, aiOverview: { present: false, cited: false } };
        })),
      })),
      mapLimit(queries, 6, async (query) => ({
        query,
        ...(await serpAnalyzeBing(query, dest.url).catch(() => ({ rank: null }))),
      })),
      keywordMetrics(queries).catch(() => ({}) as Awaited<ReturnType<typeof keywordMetrics>>),
      cachedBingMetrics(dest.id, queries).catch(
        () => ({}) as Record<string, BingKeywordMetric>
      ),
      cachedCompetitorIntel(dest),
    ]);

  // When the data provider is down or out of credit every call fails. Saving that as a snapshot
  // would show fake zeros/"—" and a fake drop on the Overview, so stop and say so instead.
  const totalAsked = engineResults.reduce((s, r) => s + r.answers.length, 0);
  const totalFailed = engineResults.reduce((s, r) => s + r.failed, 0);
  const aiAllFailed = totalAsked > 0 && totalFailed === totalAsked;
  const googleAllFailed = queries.length > 0 && serpFailed === queries.length;
  if (aiAllFailed || googleAllFailed) {
    throw new Error(
      `Couldn't get ${aiAllFailed ? "AI answers" : "Google rankings"} from the data provider — ` +
        "it may be down or out of credit (check the DataForSEO balance). Nothing was saved."
    );
  }

  const scored = engineResults.map((r) => scoreAnswers(r.answers, dest));

  const bingByQuery = new Map(bingSerp.map((b) => [b.query.toLowerCase(), b.rank]));
  const ranks: RankRow[] = serp.map((r) => {
    const m = metricsByKw[r.query.toLowerCase()];
    const bm = bingMetricsByKw[r.query.toLowerCase()];
    return {
      query: r.query,
      position: r.rank,
      bingPosition: bingByQuery.get(r.query.toLowerCase()) ?? null,
      aiOverview: r.aiOverview,
      searchVolume: m?.searchVolume ?? null,
      difficulty: m?.difficulty ?? null,
      bingSearchVolume: bm?.searchVolume ?? null,
      bingCompetition: bm?.competition ?? null,
    };
  });

  const engineShares = scored.map((s) => s.share).filter((v): v is number => v !== null);
  const aiShareOfVoice = engineShares.length
    ? engineShares.reduce((a, b) => a + b, 0) / engineShares.length
    : null;

  // Per-question AI appearance: named in ANY selected engine's answer counts as "appeared".
  const questionVisibility: QuestionVisibility[] = dest.questions.map((q, i) => ({
    text: q.text,
    type: q.type === "Commercial" ? "Commercial" : "Informational",
    answered: scored.some((s) => s.perQuestion[i]?.answered),
    appeared: scored.some((s) => s.perQuestion[i]?.appeared),
  }));

  const bucketFor = (type: "Commercial" | "Informational"): IntentBucket => {
    const measured = questionVisibility.filter((v) => v.type === type && v.answered);
    const appeared = measured.filter((v) => v.appeared).length;
    return {
      total: measured.length,
      appeared,
      rate: measured.length ? appeared / measured.length : null,
    };
  };
  const intentVisibility = {
    commercial: bucketFor("Commercial"),
    informational: bucketFor("Informational"),
  };

  const ranked = ranks.filter((r) => r.position !== null) as { position: number }[];
  const avgGoogleRank = ranked.length
    ? ranked.reduce((a, r) => a + r.position, 0) / ranked.length
    : null;

  const bingRanked = ranks.filter((r) => r.bingPosition != null) as { bingPosition: number }[];
  const avgBingRank = bingRanked.length
    ? bingRanked.reduce((a, r) => a + r.bingPosition, 0) / bingRanked.length
    : null;

  const aiOverviewPresent = ranks.filter((r) => r.aiOverview?.present).length;
  const aiOverviewCited = ranks.filter((r) => r.aiOverview?.cited).length;

  const engineAppearance = (e: EngineResult) => ({
    appeared: e.perQuestion.filter((p) => p.appeared).length,
    answered: e.perQuestion.filter((p) => p.answered).length,
  });

  // Buying-intent questions where AI gave an answer but didn't name the company — the gaps that
  // cost real customers, so the writer can prioritize them.
  const missingBuyerQuestions = questionVisibility
    .filter((v) => v.type === "Commercial" && v.answered && !v.appeared)
    .map((v) => v.text)
    .slice(0, 6);
  const companyRow = intel.traffic.find((t) => t.isCompany) ?? null;
  const topCompetitorRow = intel.traffic
    .filter((t) => !t.isCompany && t.estVisits != null)
    .sort((a, b) => (b.estVisits ?? 0) - (a.estVisits ?? 0))[0];

  // AI-written next moves. Best-effort: a writer failure must never sink the whole report.
  let recommendations: Recommendation[] = [];
  try {
    recommendations = await recommendActions({
      companyName: dest.companyName,
      shareOfVoicePct: aiShareOfVoice == null ? null : Math.round(aiShareOfVoice * 1000) / 10,
      avgGoogleRank,
      rankedCount: ranked.length,
      totalQueries: queries.length,
      aiOverviewPresent,
      aiOverviewCited,
      missingBuyerQuestions,
      keywordGaps: intel.keywordGaps.slice(0, 8).map((g) => ({
        keyword: g.keyword,
        searchVolume: g.searchVolume,
        competitor: g.competitor,
      })),
      companyVisits: companyRow?.estVisits ?? null,
      topCompetitor: topCompetitorRow
        ? { name: topCompetitorRow.name, visits: topCompetitorRow.estVisits }
        : null,
    });
  } catch {
    recommendations = [];
  }

  const spendAfter = (await getSpendLog()).totalUsd;
  const costUsd = Math.max(0, Math.round((spendAfter - spendBefore) * 10000) / 10000);

  const now = new Date();
  return {
    id: now.getTime().toString(36),
    destId: dest.id,
    subject: hostOf(dest.url),
    createdAt: now.toISOString(),
    weekOf: mondayOf(now),
    costUsd,
    metrics: {
      aiShareOfVoice,
      aiPerEngine: Object.fromEntries(engines.map((e, i) => [e, scored[i].share])),
      aiEngineAppearance: Object.fromEntries(
        engines.map((e, i) => [e, engineAppearance(scored[i])])
      ),
      intentVisibility,
      avgGoogleRank,
      rankedCount: ranked.length,
      avgBingRank,
      bingRankedCount: bingRanked.length,
      totalQueries: queries.length,
      aiOverviewPresent,
      aiOverviewCited,
      estVisits: intel.estVisits,
      realVisits: null,
      googleImpressions: null,
    },
    ranks,
    questionVisibility,
    traffic: intel.traffic,
    keywordGaps: intel.keywordGaps,
    recommendations,
  };
}
