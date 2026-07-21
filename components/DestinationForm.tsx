"use client";

import { useEffect, useRef, useState } from "react";
import {
  ALL_ENGINES,
  ENGINE_LABEL,
  ENGINE_UNIT_COST,
  destEngines,
  type EngineId,
} from "@/lib/engines";

export type Competitor = { name: string; url: string };
export type Question = {
  text: string;
  type: "Commercial" | "Informational";
  source?: "search" | "ai";
};

export type DestinationInput = {
  id?: string;
  url: string;
  companyName: string;
  aliases: string[];
  country: string;
  language: string;
  summary: string;
  competitors: Competitor[];
  questions: Question[];
  keywords: string[];
  keywordVolumes?: Record<string, number | null>;
  engines?: string[];
};

const COUNTRIES = [
  "Worldwide (default market)",
  "United States",
  "United Kingdom",
  "Germany",
  "France",
  "Spain",
  "Netherlands",
  "Armenia",
  "United Arab Emirates",
  "Singapore",
];
const LANGUAGES = ["English", "German", "French", "Spanish", "Dutch", "Armenian"];

function normalizeUrl(v: string): string {
  const t = v.trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function isValidUrl(v: string): boolean {
  if (!v.trim()) return false;
  try {
    const u = new URL(normalizeUrl(v));
    return /^https?:$/.test(u.protocol) && u.hostname.includes(".");
  } catch {
    return false;
  }
}

async function fetchIndustryPhrases(
  seeds: string[]
): Promise<{ keyword: string; searchVolume: number | null }[]> {
  const allSeeds = seeds.map((s) => (s ?? "").trim()).filter(Boolean);
  if (!allSeeds.length) return [];
  try {
    const res = await fetch("/api/keyword-ideas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seeds: allSeeds }),
    });
    const data = await res.json();
    return Array.isArray(data.ideas) ? data.ideas : [];
  } catch {
    return [];
  }
}

async function fetchAliases(companyName: string, url: string): Promise<string[]> {
  const name = companyName.trim();
  if (!name) return [];
  try {
    const res = await fetch("/api/aliases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyName: name, url }),
    });
    const data = await res.json();
    return Array.isArray(data.aliases) ? Array.from(new Set<string>(data.aliases)) : [];
  } catch {
    return [];
  }
}

// One-shot site scan used by the onboarding "Go" step: reads the site, then in parallel pulls
// industry search phrases + brand aliases, returning a fully-populated DestinationInput.
export async function scanSite(rawUrl: string): Promise<DestinationInput> {
  const url = normalizeUrl(rawUrl);
  const res = await fetch("/api/read-site", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error("scan failed");
  const data = await res.json();

  const companyName: string = (data.companyName ?? "").trim();
  const competitors: Competitor[] = Array.isArray(data.competitors) ? data.competitors : [];
  const questions: Question[] = Array.isArray(data.questions) ? data.questions : [];
  const aiKeywords: string[] = Array.isArray(data.keywords) ? data.keywords : [];
  const angles: string[] = Array.isArray(data.angles) ? data.angles : [];

  const [ideas, aliases] = await Promise.all([
    fetchIndustryPhrases(angles.length ? angles : aiKeywords),
    fetchAliases(companyName, url),
  ]);

  let keywords = aiKeywords;
  const keywordVolumes: Record<string, number | null> = {};
  if (ideas.length) {
    const top = ideas.slice(0, 12);
    keywords = top.map((i) => i.keyword);
    for (const i of top) keywordVolumes[i.keyword] = i.searchVolume;
  }

  return {
    url,
    companyName,
    aliases,
    country: data.country || COUNTRIES[0],
    language: data.language || LANGUAGES[0],
    summary: data.summary ?? "",
    competitors,
    questions,
    keywords,
    keywordVolumes,
  };
}

export default function DestinationForm({
  initial,
  onDone,
  submitLabel = "Start tracking",
  hideUrl = false,
}: {
  initial?: DestinationInput;
  onDone: (id: string) => void;
  submitLabel?: string;
  hideUrl?: boolean;
}) {
  const editing = Boolean(initial?.id);
  const [url, setUrl] = useState(initial?.url ?? "");
  const [urlTouched, setUrlTouched] = useState(false);
  const [company, setCompany] = useState(initial?.companyName ?? "");
  const [aliases, setAliases] = useState<string[]>(initial?.aliases ?? []);
  const [aliasDraft, setAliasDraft] = useState("");
  const [country, setCountry] = useState(initial?.country ?? COUNTRIES[0]);
  const [language, setLanguage] = useState(initial?.language ?? LANGUAGES[0]);
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [competitors, setCompetitors] = useState<Competitor[]>(initial?.competitors ?? []);
  const [questions, setQuestions] = useState<Question[]>(initial?.questions ?? []);
  const [keywords, setKeywords] = useState<string[]>(initial?.keywords ?? []);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keywordVolumes, setKeywordVolumes] = useState<Record<string, number | null>>(
    initial?.keywordVolumes ?? {}
  );
  const [engines, setEngines] = useState<EngineId[]>(destEngines(initial?.engines));
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [runCosts, setRunCosts] = useState<{ weeklyUsd: number; manualUsd: number } | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanFailed, setScanFailed] = useState(false);
  const [aliasLoading, setAliasLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const realQuestionCount = questions.filter((q) => q.source === "search").length;
  const urlInvalid = (urlTouched || attempted) && url.trim() !== "" && !isValidUrl(url);
  const competitorsValid = competitors.every((c) => c.name.trim() !== "" && isValidUrl(c.url));
  const canSubmit =
    isValidUrl(url) &&
    company.trim() !== "" &&
    questions.length > 0 &&
    competitorsValid &&
    !saving;

  const missing: string[] = [];
  if (!isValidUrl(url)) missing.push("a valid website URL");
  if (company.trim() === "") missing.push("a company name");
  if (questions.length === 0) missing.push("at least one question");
  if (!competitorsValid) missing.push("each competitor needs a name and valid website");

  const lastScanned = useRef(initial?.url ?? "");
  useEffect(() => {
    if (editing || hideUrl) return; // already scanned upfront (onboarding) or editing — don't auto-overwrite
    const v = url.trim();
    if (!isValidUrl(v) || v === lastScanned.current) return;
    const t = setTimeout(() => {
      lastScanned.current = v;
      scanSite();
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const lastAliasName = useRef(initial?.companyName ?? "");
  useEffect(() => {
    if (editing) return; // in edit mode, never auto-re-add aliases the user removed
    const v = company.trim();
    if (v.length < 2 || v === lastAliasName.current) return;
    const t = setTimeout(() => {
      lastAliasName.current = v;
      loadAliases();
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  // Re-price the report whenever the tracked lists change, so the cost reflects exactly what's
  // being set up right now (no id in the body → server prices from these counts, no cache reads).
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/report/estimate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: url.trim(), questions, keywords, competitors, engines }),
        });
        if (res.ok) setRunCosts(await res.json());
      } catch {
        /* cost display is best-effort */
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, keywords, competitors, url, engines]);

  function ensureOption(list: string[], value: string) {
    return list.includes(value) ? list : [value, ...list];
  }

  async function scanSite() {
    if (!isValidUrl(url)) return;
    setScanning(true);
    setScanFailed(false);
    try {
      const res = await fetch("/api/read-site", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: normalizeUrl(url) }),
      });
      if (!res.ok) throw new Error("scan failed");
      const data = await res.json();
      const newName: string = (data.companyName ?? "").trim();
      if (newName) {
        setCompany(newName);
        lastAliasName.current = newName; // stop the company-name effect from double-fetching
      }
      setSummary(data.summary ?? "");
      if (data.country) setCountry(data.country);
      if (data.language) setLanguage(data.language);
      setCompetitors(Array.isArray(data.competitors) ? data.competitors : []);
      setQuestions(Array.isArray(data.questions) ? data.questions : []);
      const aiKeywords: string[] = Array.isArray(data.keywords) ? data.keywords : [];
      const angles: string[] = Array.isArray(data.angles) ? data.angles : [];
      setKeywords(aiKeywords);
      loadIndustryPhrases(angles.length ? angles : aiKeywords);
      // refill aliases for the (possibly new) company, replacing the old site's aliases
      loadAliases(newName || company, true);
    } catch {
      setScanFailed(true);
    } finally {
      setScanning(false);
    }
  }

  async function loadIndustryPhrases(seeds: string[]) {
    const allSeeds = seeds.map((s) => (s ?? "").trim()).filter(Boolean);
    if (!allSeeds.length) return;
    setIdeasLoading(true);
    try {
      const res = await fetch("/api/keyword-ideas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seeds: allSeeds }),
      });
      const data = await res.json();
      const ideas: { keyword: string; searchVolume: number | null }[] = Array.isArray(data.ideas)
        ? data.ideas
        : [];
      if (!ideas.length) return;
      const top = ideas.slice(0, 12);
      setKeywords(top.map((i) => i.keyword));
      const vols: Record<string, number | null> = {};
      for (const i of top) vols[i.keyword] = i.searchVolume;
      setKeywordVolumes(vols);
    } catch {
      /* industry phrases optional — fall back to AI keywords */
    } finally {
      setIdeasLoading(false);
    }
  }

  async function loadAliases(nameArg?: string, replace = false) {
    const name = (nameArg ?? company).trim();
    if (name === "") return;
    setAliasLoading(true);
    try {
      const res = await fetch("/api/aliases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyName: name, url: url.trim() }),
      });
      const data = await res.json();
      const next: string[] = Array.isArray(data.aliases) ? data.aliases : [];
      if (replace) {
        if (next.length) setAliases(Array.from(new Set(next))); // re-scan: swap in the new site's aliases
      } else {
        setAliases((prev) => Array.from(new Set([...prev, ...next])));
      }
    } catch {
      /* aliases optional */
    } finally {
      setAliasLoading(false);
    }
  }

  function addAlias() {
    const v = aliasDraft.trim();
    if (v && !aliases.includes(v)) setAliases([...aliases, v]);
    setAliasDraft("");
  }

  function toggleEngine(e: EngineId) {
    setEngines((cur) =>
      cur.includes(e)
        ? cur.length > 1
          ? cur.filter((x) => x !== e)
          : cur // keep at least one chatbot selected
        : ALL_ENGINES.filter((x) => cur.includes(x) || x === e)
    );
  }

  function addKeyword() {
    const v = keywordDraft.trim();
    if (v && !keywords.includes(v)) {
      setKeywords([...keywords, v]); // no volume lookup — newly added phrases show no /mo until a report runs
    }
    setKeywordDraft("");
  }

  async function submit() {
    setAttempted(true);
    if (!canSubmit) return;
    setSaving(true);
    try {
      const payload = {
        url: normalizeUrl(url),
        companyName: company.trim(),
        aliases,
        country,
        language,
        summary,
        competitors,
        questions,
        keywords,
        keywordVolumes,
        engines,
      };
      const editing = Boolean(initial?.id);
      const res = await fetch("/api/destinations", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editing ? { id: initial!.id, ...payload } : payload),
      });
      if (!res.ok) throw new Error("save failed");
      const data = await res.json();
      onDone(data.id ?? initial?.id ?? "");
    } catch {
      setSaving(false);
    }
  }

  const countryOpts = ensureOption(COUNTRIES, country);
  const langOpts = ensureOption(LANGUAGES, language);

  return (
    <div>
      <Section title="The destination">
        {!hideUrl && (
          <Field label="Website URL" required missing={attempted && url.trim() === ""}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => setUrlTouched(true)}
              placeholder="hexens.io"
              className={input(urlInvalid)}
            />
            {urlInvalid && <Err>Please enter a valid URL</Err>}
            {scanning && (
              <Hint>
                <span className="mr-1 inline-block animate-pulse text-accent2">●</span>
                Reading the website&hellip; the AI is filling in the details below.
              </Hint>
            )}
            {scanFailed && (
              <Hint amber>Couldn&rsquo;t read the site, you can fill these in manually.</Hint>
            )}
            {editing && (
              <button
                type="button"
                onClick={() => {
                  lastScanned.current = url.trim();
                  scanSite();
                }}
                disabled={!isValidUrl(url) || scanning}
                className="mt-2 rounded-lg border border-accent/60 px-3 py-1.5 text-xs font-medium text-accent2 hover:bg-accent/10 disabled:cursor-not-allowed disabled:border-edge disabled:text-muted"
              >
                Re-scan site &amp; refill details
              </button>
            )}
          </Field>
        )}

        <Field label="Company name" required missing={attempted && company.trim() === ""}>
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Hexens"
            className={input(false)}
          />
          <p className="mt-1 text-xs text-muted">This is the name we search for in AI answers.</p>
        </Field>

        {(company.trim() !== "" || aliases.length > 0) && (
          <Field label="Aliases">
            <div className="flex flex-wrap items-center gap-2">
              {aliases.map((a) => (
                <span
                  key={a}
                  className="flex items-center gap-1 rounded-full border border-edge bg-panel-2 px-3 py-1 text-sm"
                >
                  {a}
                  <button
                    type="button"
                    onClick={() => setAliases(aliases.filter((x) => x !== a))}
                    className="text-muted hover:text-foreground"
                    aria-label={`Remove ${a}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              {aliasLoading && <span className="text-sm text-muted">suggesting&hellip;</span>}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={aliasDraft}
                onChange={(e) => setAliasDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAlias();
                  }
                }}
                placeholder="Type an alias and press Add"
                className={input(false) + " flex-1"}
              />
              <button
                type="button"
                onClick={addAlias}
                disabled={aliasDraft.trim() === ""}
                className="shrink-0 rounded-lg border border-accent/60 px-4 py-2 text-sm font-medium text-accent2 hover:bg-accent/10 disabled:cursor-not-allowed disabled:border-edge disabled:text-muted"
              >
                Add
              </button>
            </div>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Country / market">
            <select value={country} onChange={(e) => setCountry(e.target.value)} className={input(false)}>
              {countryOpts.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Language">
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className={input(false)}>
              {langOpts.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="About this company">
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={4}
          placeholder="A short summary of what the company does. The AI fills this after reading the site; you can edit it."
          className={input(false) + " resize-y"}
        />
      </Section>

      <Section title="Competitors" hint="Optional, but recommended.">
        <EditableList
          items={competitors}
          onChange={setCompetitors}
          render={(c, set) => {
            const urlBad = c.url.trim() !== "" && !isValidUrl(c.url);
            const urlMissing = attempted && c.url.trim() === "";
            const nameBad = attempted && c.name.trim() === "";
            return (
              <div className="flex-1">
                <div className="flex gap-2">
                  <input
                    value={c.name}
                    onChange={(e) => set({ ...c, name: e.target.value })}
                    placeholder="Name"
                    className={input(nameBad) + " flex-1"}
                  />
                  <input
                    value={c.url}
                    onChange={(e) => set({ ...c, url: e.target.value })}
                    placeholder="Website (e.g. example.com)"
                    className={input(urlBad || urlMissing) + " flex-1"}
                  />
                </div>
                {nameBad && <p className="mt-1 text-xs text-rose-600">Name required</p>}
                {(urlBad || urlMissing) && (
                  <p className="mt-1 text-xs text-rose-600">Enter a valid website</p>
                )}
              </div>
            );
          }}
          empty={{ name: "", url: "" }}
          addLabel="Add competitor"
        />
      </Section>

      <Section
        title="Questions to track"
        hint="These are pulled from what people really search on Google for your field — Google’s “People also ask” box and search autocomplete. Edit freely; at least one is required."
      >
        {realQuestionCount > 0 && (
          <p className="-mt-1 mb-1 text-sm text-accent2">
            {realQuestionCount} of {questions.length} taken from real Google searches.
          </p>
        )}
        <EditableList
          items={questions}
          onChange={setQuestions}
          render={(q, set) => (
            <div className="flex flex-1 items-center gap-2">
              <input
                value={q.text}
                onChange={(e) => set({ ...q, text: e.target.value })}
                placeholder='e.g. "best smart contract audit firm"'
                className={input(false) + " flex-1"}
              />
              <SourceTag source={q.source} />
              <select
                value={q.type}
                onChange={(e) => set({ ...q, type: e.target.value as Question["type"] })}
                className="rounded-lg border border-edge bg-panel-2 px-2 py-2 text-sm"
              >
                <option>Commercial</option>
                <option>Informational</option>
              </select>
            </div>
          )}
          empty={{ text: "", type: "Commercial" }}
          addLabel="Add question"
        />
        {questions.length === 0 && attempted && <Err>At least one question is required</Err>}
      </Section>

      <Section
        title="Google search phrases"
        hint="The top phrases people actually search in your industry, ranked by how many search them on Google each month. Edit freely — these are what we check your Google rank for."
      >
        {(ideasLoading || (scanning && keywords.length === 0)) && (
          <p className="-mt-1 mb-2 text-sm text-accent2">
            <span className="mr-1 inline-block animate-pulse">●</span>
            Finding the most-searched phrases in your industry&hellip;
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {keywords.map((k) => {
            const vol = keywordVolumes[k];
            return (
              <span
                key={k}
                className="flex items-center gap-2 rounded-full border border-edge bg-panel-2 py-1 pl-3 pr-1 text-sm"
              >
                {k}
                {vol != null && (
                  <span
                    title="How many people search this phrase on Google each month"
                    className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent2"
                  >
                    {formatVolume(vol)}/mo
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setKeywords(keywords.filter((x) => x !== k))}
                  className="px-1 text-muted hover:text-foreground"
                  aria-label={`Remove ${k}`}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addKeyword();
              }
            }}
            placeholder='e.g. "web3 security firms"'
            className={input(false) + " flex-1"}
          />
          <button
            type="button"
            onClick={addKeyword}
            disabled={keywordDraft.trim() === ""}
            className="shrink-0 rounded-lg border border-accent/60 px-4 py-2 text-sm font-medium text-accent2 hover:bg-accent/10 disabled:cursor-not-allowed disabled:border-edge disabled:text-muted"
          >
            Add
          </button>
        </div>
      </Section>

      {!editing && (
        <Section
          title="AI chatbots to ask"
          hint="Each report asks these AIs your tracked questions to measure how visible you are. Every chatbot you add widens the picture — and adds its own cost. You can change this later in Settings."
        >
          <div className="space-y-2">
            {ALL_ENGINES.map((e) => {
              const on = engines.includes(e);
              const nQ = questions.filter((q) => q.text.trim() !== "").length;
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => toggleEngine(e)}
                  aria-pressed={on}
                  className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition ${
                    on ? "border-accent bg-[#dbeaff]/40" : "border-edge bg-panel-2 hover:border-accent/50"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className={`flex h-5 w-5 items-center justify-center rounded border text-xs font-bold ${
                        on ? "border-accent bg-accent text-white" : "border-edge bg-white text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                    <span className="text-sm font-semibold text-foreground">{ENGINE_LABEL[e]}</span>
                  </span>
                  <span className="text-xs text-muted">
                    <span className="font-medium text-foreground/80">
                      +${(nQ * ENGINE_UNIT_COST[e]).toFixed(2)}
                    </span>{" "}
                    per weekly report
                  </span>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      <div className="mt-8 rounded-xl border border-edge bg-panel-2 p-4">
        <h2 className="text-sm font-semibold text-foreground">What each report will cost</h2>
        <p className="mt-1 text-xs text-muted">
          Based on {questions.filter((q) => q.text.trim() !== "").length} questions
          {keywords.filter((k) => k.trim() !== "").length > 0 &&
            ` · ${keywords.filter((k) => k.trim() !== "").length} Google phrases`}{" "}
          · {competitors.filter((c) => c.url.trim() !== "").length} competitors. Updates as you edit.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-edge bg-panel px-3 py-2">
            <div className="text-xs text-muted">Weekly run (full)</div>
            <div className="text-xl font-bold text-foreground">
              {runCosts ? `$${runCosts.weeklyUsd.toFixed(2)}` : "…"}
            </div>
            <div className="mt-0.5 text-[11px] text-muted">AI answers + Google + competitors</div>
          </div>
          <div className="rounded-lg border border-edge bg-panel px-3 py-2">
            <div className="text-xs text-muted">Manual re-run (same week)</div>
            <div className="text-xl font-bold text-foreground">
              {runCosts ? `$${runCosts.manualUsd.toFixed(2)}` : "…"}
            </div>
            <div className="mt-0.5 text-[11px] text-muted">Google rankings only</div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Your first report costs the full weekly price; cheaper re-runs apply for the rest of that
          week.
        </p>
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={submit}
        className={`mt-4 w-full rounded-lg px-4 py-3 font-semibold transition ${
          canSubmit
            ? "glow bg-black text-white hover:bg-black/85"
            : "border border-edge bg-panel-2 text-muted"
        }`}
      >
        {saving ? "Saving…" : submitLabel}
      </button>
      {attempted && !canSubmit && !saving && missing.length > 0 && (
        <p className="mt-2 text-center text-sm text-rose-600">Still need: {missing.join(", ")}.</p>
      )}
    </div>
  );
}

/* ---------- UI helpers ---------- */

function formatVolume(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function input(invalid: boolean) {
  return `w-full rounded-lg border bg-panel-2 px-3 py-2 text-foreground outline-none transition focus:border-accent ${
    invalid ? "border-rose-500" : "border-edge"
  }`;
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  missing,
  children,
}: {
  label: string;
  required?: boolean;
  missing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="text-sm font-medium text-foreground/80">
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
      {missing && <Err>Required</Err>}
    </div>
  );
}

function SourceTag({ source }: { source?: "search" | "ai" }) {
  if (source === "search")
    return (
      <span
        title="From real Google searches: People also ask and autocomplete"
        className="shrink-0 whitespace-nowrap rounded-full border border-accent/50 bg-accent/10 px-2 py-1 text-xs font-medium text-accent2"
      >
        Real search
      </span>
    );
  if (source === "ai")
    return (
      <span
        title="Suggested by AI to round out your list"
        className="shrink-0 whitespace-nowrap rounded-full border border-edge bg-panel-2 px-2 py-1 text-xs text-muted"
      >
        AI
      </span>
    );
  return null;
}

function Err({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-sm text-rose-600">{children}</p>;
}

function Hint({ children, amber }: { children: React.ReactNode; amber?: boolean }) {
  return (
    <p className={`mt-1 text-sm ${amber ? "text-amber-600" : "text-muted"}`}>{children}</p>
  );
}

function EditableList<T>({
  items,
  onChange,
  render,
  empty,
  addLabel,
}: {
  items: T[];
  onChange: (next: T[]) => void;
  render: (item: T, set: (next: T) => void) => React.ReactNode;
  empty: T;
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          {render(item, (next) => {
            const copy = [...items];
            copy[i] = next;
            onChange(copy);
          })}
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="shrink-0 text-muted hover:text-rose-600"
            aria-label="Remove"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, { ...empty }])}
        className="text-sm font-medium text-accent2 hover:underline"
      >
        + {addLabel}
      </button>
    </div>
  );
}
