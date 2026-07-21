import { recordSpend } from "./spend";
import type { EngineId } from "./engines";

const BASE = "https://api.dataforseo.com";

function authHeader() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error("DataForSEO credentials missing");
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

async function post<T = unknown>(path: string, task: Record<string, unknown>): Promise<T> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify([task]),
    signal: AbortSignal.timeout(120000),
  });
  const json = await res.json();
  await recordSpend(path, json.cost);
  if (json.status_code !== 20000) {
    throw new Error(`DataForSEO ${path}: ${json.status_code} ${json.status_message}`);
  }
  const t = json.tasks?.[0];
  if (!t || t.status_code !== 20000) {
    throw new Error(`DataForSEO task ${path}: ${t?.status_code} ${t?.status_message}`);
  }
  return t.result as T;
}

/** Live account balance in USD, or null if unavailable. Free endpoint — costs nothing. */
export async function getBalance(): Promise<number | null> {
  try {
    const res = await fetch(BASE + "/v3/appendix/user_data", {
      headers: { Authorization: authHeader() },
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json();
    const balance = json?.tasks?.[0]?.result?.[0]?.money?.balance;
    return typeof balance === "number" ? balance : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

export type SerpResult = {
  /** Google organic position (rank_absolute) within top 100, or null if absent. */
  rank: number | null;
  /** Google AI Overview ("AI answer at the top of search") signals for this query. */
  aiOverview: { present: boolean; cited: boolean };
};

function hostMatches(itemHost: string, target: string): boolean {
  return itemHost === target || itemHost.endsWith(`.${target}`) || target.endsWith(`.${itemHost}`);
}

/**
 * One Google search for `keyword`: where `targetUrl`'s domain ranks organically, plus whether
 * Google's AI Overview shows for this query and whether it cites the target's domain.
 */
export async function serpAnalyze(keyword: string, targetUrl: string): Promise<SerpResult> {
  const target = hostOf(targetUrl);
  const result = await post<Array<{ items?: Array<Record<string, unknown>> }>>(
    "/v3/serp/google/organic/live/advanced",
    {
      keyword: keyword.slice(0, 700),
      location_code: 2840,
      language_code: "en",
      depth: 100,
      load_async_ai_overview: true,
    }
  );
  const items = result?.[0]?.items ?? [];

  let rank: number | null = null;
  const aiOverview = { present: false, cited: false };

  for (const it of items) {
    if (it.type === "organic" && rank === null) {
      const itemUrl = (it.url as string) || (it.domain as string) || "";
      if (hostMatches(hostOf(itemUrl), target)) {
        rank = (it.rank_absolute as number) ?? (it.rank_group as number) ?? null;
      }
    } else if (it.type === "ai_overview") {
      aiOverview.present = true;
      const refs = (it.references as Array<{ domain?: string; url?: string }>) ?? [];
      for (const ref of refs) {
        const refHost = hostOf((ref.domain as string) || (ref.url as string) || "");
        if (refHost && hostMatches(refHost, target)) {
          aiOverview.cited = true;
          break;
        }
      }
    }
  }
  return { rank, aiOverview };
}

export type BingSerpResult = {
  /** Bing organic position (rank_absolute) within top 50, or null if absent. */
  rank: number | null;
};

/**
 * One Bing search for `keyword`: where `targetUrl`'s domain ranks organically. Bing has no
 * "AI Overview" (that's a Google-only feature), so we only return the organic position.
 */
export async function serpAnalyzeBing(keyword: string, targetUrl: string): Promise<BingSerpResult> {
  const target = hostOf(targetUrl);
  const result = await post<Array<{ items?: Array<Record<string, unknown>> }>>(
    "/v3/serp/bing/organic/live/advanced",
    {
      keyword: keyword.slice(0, 700),
      location_code: 2840,
      language_code: "en",
      depth: 50,
    }
  );
  const items = result?.[0]?.items ?? [];

  let rank: number | null = null;
  for (const it of items) {
    if (it.type !== "organic") continue;
    const itemUrl = (it.url as string) || (it.domain as string) || "";
    if (hostMatches(hostOf(itemUrl), target)) {
      rank = (it.rank_absolute as number) ?? (it.rank_group as number) ?? null;
      break;
    }
  }
  return { rank };
}

export type KeywordMetric = { searchVolume: number | null; difficulty: number | null };

/**
 * Monthly Google search volume + ranking difficulty (0-100) for each phrase, in one call.
 * Returns a map keyed by the lowercased phrase. Phrases Google has no data for are omitted.
 */
export async function keywordMetrics(keywords: string[]): Promise<Record<string, KeywordMetric>> {
  const cleaned = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 700);
  if (!cleaned.length) return {};
  const result = await post<Array<{ items?: Array<Record<string, unknown>> }>>(
    "/v3/dataforseo_labs/google/keyword_overview/live",
    { keywords: cleaned, location_code: 2840, language_code: "en" }
  );
  const items = result?.[0]?.items ?? [];
  const out: Record<string, KeywordMetric> = {};
  for (const it of items) {
    const kw = (it.keyword as string)?.toLowerCase();
    if (!kw) continue;
    const info = it.keyword_info as { search_volume?: number } | undefined;
    const props = it.keyword_properties as { keyword_difficulty?: number } | undefined;
    out[kw] = {
      searchVolume: info?.search_volume ?? null,
      difficulty: props?.keyword_difficulty ?? null,
    };
  }
  return out;
}

export type BingKeywordMetric = { searchVolume: number | null; competition: number | null };

/**
 * Bing's own monthly search volume + advertiser competition (0..1) for each phrase, in one call
 * (Microsoft Ads data). Keyed by the lowercased phrase. ~$0.09 per call regardless of list size.
 */
export async function bingKeywordMetrics(
  keywords: string[]
): Promise<Record<string, BingKeywordMetric>> {
  const cleaned = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 1000);
  if (!cleaned.length) return {};
  const result = await post<Array<Record<string, unknown>>>(
    "/v3/keywords_data/bing/search_volume/live",
    { keywords: cleaned, location_code: 2840, language_code: "en" }
  );
  const out: Record<string, BingKeywordMetric> = {};
  for (const it of result ?? []) {
    const kw = (it.keyword as string)?.toLowerCase();
    if (!kw) continue;
    out[kw] = {
      searchVolume: typeof it.search_volume === "number" ? it.search_volume : null,
      competition: typeof it.competition === "number" ? it.competition : null,
    };
  }
  return out;
}

export type KeywordIdea = {
  keyword: string;
  searchVolume: number | null;
  difficulty: number | null;
};

/** Collapse word-order twins ("blockchain security" == "security blockchain") to one signature. */
function phraseSignature(kw: string): string {
  return [
    ...new Set(
      kw
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
    ),
  ]
    .sort()
    .join(" ");
}

/**
 * Industry phrases kept on-topic AND diverse across your competitive layers.
 * Each seed phrase (the AI's keywords) gets its own keyword_suggestions list — so every
 * result contains a seed and generic high-volume terms can't drift in. We then round-robin
 * across the seeds (one phrase per topic per round, highest volume first) so the final list
 * covers every layer instead of being dominated by one. Calls per seed (~$0.01 each), max 6.
 */
export async function keywordIdeas(seeds: string[], perSeed = 30): Promise<KeywordIdea[]> {
  const cleaned = [
    ...new Set(seeds.map((s) => s.trim().toLowerCase()).filter(Boolean)),
  ].slice(0, 6);
  if (!cleaned.length) return [];

  const lists = await Promise.all(
    cleaned.map((seed) =>
      post<Array<{ items?: Array<Record<string, unknown>> }>>(
        "/v3/dataforseo_labs/google/keyword_suggestions/live",
        {
          keyword: seed,
          location_code: 2840,
          language_code: "en",
          limit: Math.min(perSeed, 1000),
          order_by: ["keyword_info.search_volume,desc"],
        }
      ).catch(() => null)
    )
  );

  // One sorted bucket per seed; drop word-order twins within each bucket.
  const buckets: KeywordIdea[][] = lists.map((result) => {
    const seen = new Set<string>();
    const ideas: KeywordIdea[] = [];
    for (const it of result?.[0]?.items ?? []) {
      const kw = it.keyword as string;
      if (!kw) continue;
      const sig = phraseSignature(kw);
      if (seen.has(sig)) continue;
      seen.add(sig);
      const info = it.keyword_info as { search_volume?: number } | undefined;
      const props = it.keyword_properties as { keyword_difficulty?: number } | undefined;
      ideas.push({
        keyword: kw,
        searchVolume: info?.search_volume ?? null,
        difficulty: props?.keyword_difficulty ?? null,
      });
    }
    return ideas.sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0));
  });

  // Round-robin: take the next-best phrase from each topic in turn, skipping global twins.
  const usedSig = new Set<string>();
  const out: KeywordIdea[] = [];
  const cursors = new Array(buckets.length).fill(0);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (let b = 0; b < buckets.length; b++) {
      const bucket = buckets[b];
      let i = cursors[b];
      while (i < bucket.length && usedSig.has(phraseSignature(bucket[i].keyword))) i++;
      if (i < bucket.length) {
        const idea = bucket[i];
        usedSig.add(phraseSignature(idea.keyword));
        out.push(idea);
        cursors[b] = i + 1;
        progressed = true;
      } else {
        cursors[b] = i;
      }
    }
  }
  return out;
}

export type DomainTraffic = { estVisits: number | null; keywordCount: number | null };

/** Estimated monthly organic (Google) visits + how many keywords each domain ranks for, in one call. */
export async function trafficEstimate(domains: string[]): Promise<Record<string, DomainTraffic>> {
  const targets = [...new Set(domains.map(hostOf).filter(Boolean))].slice(0, 1000);
  if (!targets.length) return {};
  const result = await post<Array<{ items?: Array<Record<string, unknown>> }>>(
    "/v3/dataforseo_labs/google/bulk_traffic_estimation/live",
    { targets, location_code: 2840, language_code: "en" }
  );
  const items = result?.[0]?.items ?? [];
  const out: Record<string, DomainTraffic> = {};
  for (const it of items) {
    const target = hostOf((it.target as string) || "");
    if (!target) continue;
    const organic = (it.metrics as { organic?: { etv?: number; count?: number } } | undefined)
      ?.organic;
    out[target] = {
      estVisits: organic?.etv != null ? Math.round(organic.etv) : null,
      keywordCount: organic?.count ?? null,
    };
  }
  return out;
}

export type RankedKeyword = { keyword: string; searchVolume: number | null; rank: number | null };

/** Top keywords (by estimated traffic) that `domain` already ranks for on Google. */
export async function rankedKeywords(domain: string, limit = 100): Promise<RankedKeyword[]> {
  const target = hostOf(domain);
  if (!target) return [];
  const result = await post<Array<{ items?: Array<Record<string, unknown>> }>>(
    "/v3/dataforseo_labs/google/ranked_keywords/live",
    {
      target,
      location_code: 2840,
      language_code: "en",
      limit: Math.min(limit, 1000),
      order_by: ["ranked_serp_element.serp_item.etv,desc"],
    }
  );
  const items = result?.[0]?.items ?? [];
  const out: RankedKeyword[] = [];
  for (const it of items) {
    const kd = it.keyword_data as
      | { keyword?: string; keyword_info?: { search_volume?: number } }
      | undefined;
    const serp = (it.ranked_serp_element as { serp_item?: { rank_absolute?: number } } | undefined)
      ?.serp_item;
    if (!kd?.keyword) continue;
    out.push({
      keyword: kd.keyword,
      searchVolume: kd.keyword_info?.search_volume ?? null,
      rank: serp?.rank_absolute ?? null,
    });
  }
  return out;
}

const LLM_PATH: Record<EngineId, string> = {
  chatgpt: "/v3/ai_optimization/chat_gpt/llm_responses/live",
  gemini: "/v3/ai_optimization/gemini/llm_responses/live",
  perplexity: "/v3/ai_optimization/perplexity/llm_responses/live",
  claude: "/v3/ai_optimization/claude/llm_responses/live",
};
const LLM_MODEL: Record<EngineId, string> = {
  chatgpt: "gpt-4.1-mini",
  gemini: "gemini-2.5-flash",
  perplexity: "sonar",
  claude: "claude-sonnet-4-6",
};

/** Ask an AI engine a question and return its plain-text answer. */
export async function llmAnswer(engine: EngineId, prompt: string): Promise<string> {
  const result = await post<Array<{ items?: Array<Record<string, unknown>> }>>(LLM_PATH[engine], {
    user_prompt: prompt.slice(0, 500),
    model_name: LLM_MODEL[engine],
    max_output_tokens: 1024,
    web_search: true,
  });
  const items = result?.[0]?.items ?? [];
  const message = items.find((i) => i.type === "message");
  const sections = (message?.sections as Array<{ text?: string }>) ?? [];
  return sections.map((s) => s.text ?? "").join("\n").trim();
}

// Leading words that mark a string as a real customer question/query worth tracking.
const QUESTION_LEAD =
  /^(how|what|why|which|when|where|who|whose|whom|is|are|am|can|could|does|do|did|should|would|will|best|top)\b/i;

// Prefixes used to coax question-shaped suggestions out of Google autocomplete.
const Q_PREFIXES = ["how", "what", "why", "best", "is", "which"];

function looksLikeQuestion(s: string): boolean {
  const t = s.trim();
  return t.endsWith("?") || QUESTION_LEAD.test(t) || / vs /i.test(t);
}

/** Google autocomplete suggestions for a seed phrase — what people actually start typing. */
async function autocomplete(seed: string): Promise<string[]> {
  const result = await post<Array<{ items?: Array<Record<string, unknown>> }>>(
    "/v3/serp/google/autocomplete/live/advanced",
    { keyword: seed.slice(0, 700), location_code: 2840, language_code: "en" }
  );
  const items = result?.[0]?.items ?? [];
  return items
    .map((i) => (i.suggestion as string) || (i.value as string) || "")
    .filter(Boolean);
}

/** Real "People also ask" questions Google shows for a seed phrase. */
async function peopleAlsoAsk(seed: string): Promise<string[]> {
  const result = await post<Array<{ items?: Array<Record<string, unknown>> }>>(
    "/v3/serp/google/organic/live/advanced",
    { keyword: seed.slice(0, 700), location_code: 2840, language_code: "en", depth: 10 }
  );
  const items = result?.[0]?.items ?? [];
  const out: string[] = [];
  for (const it of items) {
    if (it.type !== "people_also_ask") continue;
    const paa = (it.items as Array<Record<string, unknown>>) ?? [];
    for (const q of paa) {
      const title = (q.title as string) || (q.seed_question as string) || "";
      if (title) out.push(title);
    }
  }
  return out;
}

/**
 * Real questions people search for around the given seed phrases, from Google's
 * "People also ask" box (primary) and search autocomplete (secondary). De-duped,
 * question-shaped, capped at `max`. Returns [] if seeds are empty or every call fails.
 */
export async function discoverQuestions(seeds: string[], max = 15): Promise<string[]> {
  const cleanSeeds = [
    ...new Set(seeds.map((s) => s.trim().toLowerCase()).filter(Boolean)),
  ].slice(0, 2);
  if (!cleanSeeds.length) return [];

  // Autocomplete on the bare seed plus question-prefixed variants ("how <seed>", "best <seed>"…),
  // which is what reliably surfaces real question-shaped queries.
  const acSeeds = cleanSeeds.flatMap((s) => [s, ...Q_PREFIXES.map((p) => `${p} ${s}`)]);

  const [paaResults, acResults] = await Promise.all([
    Promise.allSettled(cleanSeeds.map(peopleAlsoAsk)),
    Promise.allSettled(acSeeds.map(autocomplete)),
  ]);

  const collect = (settled: PromiseSettledResult<string[]>[]) =>
    settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  // People-also-ask first (full natural questions), then autocomplete completions.
  const candidates = [...collect(paaResults), ...collect(acResults)];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const text = raw.trim();
    if (!looksLikeQuestion(text)) continue;
    const norm = text.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(text.charAt(0).toUpperCase() + text.slice(1));
    if (out.length >= max) break;
  }
  return out;
}
