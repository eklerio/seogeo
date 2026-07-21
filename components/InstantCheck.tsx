"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ALL_ENGINES, ENGINE_LABEL, type EngineId } from "@/lib/engines";

const ENGINES = ALL_ENGINES.map((id) => ({ id, label: ENGINE_LABEL[id] }));
type Engine = EngineId;

type Result = { engine: Engine; answer: string; mentioned: boolean; error: boolean };

type TrackedQuestion = { text: string; type: "Commercial" | "Informational" };

type Dest = {
  id: string;
  companyName: string;
  aliases: string[];
  questions: TrackedQuestion[];
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Same whole-word matching as the report scorer, so the highlight always agrees with the verdict.
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

// AI answers come back as light markdown: render **bold** and [label](url) links instead of
// showing the raw symbols, keep the company-name highlighting inside plain text.
function renderAnswer(text: string, companyTerms: string[]): React.ReactNode {
  const parts = text.split(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g);
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    nodes.push(<Fragment key={`t${i}`}>{renderBold(parts[i], companyTerms)}</Fragment>);
    if (i + 2 < parts.length) {
      nodes.push(
        <a
          key={`a${i}`}
          href={parts[i + 2]}
          target="_blank"
          rel="noreferrer"
          className="break-all text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
        >
          {parts[i + 1]}
        </a>
      );
    }
  }
  return nodes;
}

function renderBold(text: string, companyTerms: string[]): React.ReactNode {
  return text.split(/\*\*([^*\n]+)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-foreground">
        {highlightNames(part, companyTerms)}
      </strong>
    ) : (
      <Fragment key={i}>{highlightNames(part, companyTerms)}</Fragment>
    )
  );
}

const COMMERCIAL_HINT = /\b(best|top|vs|versus|price|pricing|cost|cheap|hire|buy|agency|compan(?:y|ies)|service|provider|firm|tool)s?\b/i;

export default function InstantCheck({
  destination,
  costs,
  onAddQuestion,
}: {
  destination: Dest;
  costs: Record<Engine, number>;
  onAddQuestion: (q: TrackedQuestion) => void;
}) {
  const [question, setQuestion] = useState("");
  // Nothing pre-selected on purpose: a pre-ticked engine once billed Gemini when Elen
  // thought she was asking ChatGPT only. The user must explicitly pick what to ask.
  const [selected, setSelected] = useState<Engine[]>([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [ranQuestion, setRanQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The tab unmounts when switching pages, so the check lives in sessionStorage (per board)
  // until the browser session ends or the user clears it.
  const storageKey = `instant-check:${destination.id}`;
  const restored = useRef(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as {
        question?: string;
        selected?: Engine[];
        results?: Result[] | null;
        ranQuestion?: string;
      } | null;
      if (saved) {
        setQuestion(saved.question ?? "");
        setSelected(saved.selected ?? []);
        setResults(saved.results ?? null);
        setRanQuestion(saved.ranQuestion ?? "");
      }
    } catch {
      /* corrupt/blocked storage — start fresh */
    }
    restored.current = true;
  }, [storageKey]);
  useEffect(() => {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ question, selected, results, ranQuestion }));
    } catch {
      /* storage full/blocked — the check just won't survive a tab switch */
    }
  }, [storageKey, question, selected, results, ranQuestion]);

  function clearCheck() {
    setQuestion("");
    setResults(null);
    setRanQuestion("");
    setError(null);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
  }

  const cost = selected.reduce((s, e) => s + costs[e], 0);
  const canRun = question.trim().length > 3 && selected.length > 0 && !running;
  const alreadyTracked = destination.questions.some(
    (q) => q.text.trim().toLowerCase() === ranQuestion.trim().toLowerCase()
  );

  function toggle(e: Engine) {
    setSelected((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));
  }

  async function run() {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/instant-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destId: destination.id, question: question.trim(), engines: selected }),
      });
      if (!res.ok) throw new Error();
      const d = (await res.json()) as { results: Result[] };
      setResults(d.results);
      setRanQuestion(question.trim());
    } catch {
      setError("Something went wrong asking the AIs — try again in a moment.");
    } finally {
      setRunning(false);
    }
  }

  function addToTracked() {
    if (!ranQuestion || alreadyTracked) return;
    const type = COMMERCIAL_HINT.test(ranQuestion) ? "Commercial" : "Informational";
    onAddQuestion({ text: ranQuestion, type });
  }

  const companyTerms = [destination.companyName, ...destination.aliases];

  // Show one of the board's real tracked questions as the example, so it's relevant
  // to what we actually watch for this company (falls back if none are tracked yet).
  const placeholderQuestion =
    destination.questions.find((q) => q.text.trim())?.text.trim() ??
    "e.g. What are the best web3 security audit companies?";

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Instant check</h1>
      <p className="mt-1 text-sm text-muted">Type any question to see the AI outputs.</p>

      <div className="glass mt-6 rounded-2xl p-6">
        <label className="text-sm font-medium text-foreground/80">Your question</label>
        <input
          autoFocus
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
          placeholder={placeholderQuestion}
          className="mt-2 w-full rounded-lg border border-edge bg-panel-2 px-3 py-3 text-foreground outline-none transition focus:border-accent"
        />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Ask:</span>
          {ENGINES.map((e) => {
            const on = selected.includes(e.id);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => toggle(e.id)}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                  on
                    ? "border-accent bg-[#dbeaff] text-foreground"
                    : "border-edge bg-panel-2 text-muted hover:text-foreground"
                }`}
              >
                {on ? "✓ " : ""}
                {e.label}
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={run}
            disabled={!canRun}
            className={`rounded-lg px-6 py-3 font-semibold transition ${
              canRun
                ? "glow bg-black text-white hover:bg-black/85"
                : "border border-edge bg-panel-2 text-muted"
            }`}
          >
            {running
              ? "Asking…"
              : selected.length === 0
                ? "Run check"
                : `Run check · $${cost.toFixed(2)}`}
          </button>
          <span className="text-xs text-muted">
            {selected.length === 0
              ? "Pick at least one AI above to run."
              : `Asks only: ${selected
                  .map((e) => ENGINES.find((x) => x.id === e)!.label)
                  .join(" + ")}. Live answers, paid per run.`}
          </span>
        </div>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </div>

      {running && (
        <div className="glass mt-6 flex items-center gap-4 rounded-2xl p-6">
          <div className="relative h-8 w-8 shrink-0">
            <div className="absolute inset-0 rounded-full border-[3px] border-edge" />
            <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-black" />
          </div>
          <p className="text-sm text-muted">
            Asking {selected.map((e) => ENGINES.find((x) => x.id === e)!.label).join(" and ")} your
            question — usually takes 10–30 seconds.
          </p>
        </div>
      )}

      {results && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Results for <span className="font-medium text-foreground">“{ranQuestion}”</span>
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={addToTracked}
                disabled={alreadyTracked}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  alreadyTracked
                    ? "border-edge bg-panel-2 text-emerald-700"
                    : "border-edge bg-panel-2 text-foreground hover:border-accent"
                }`}
              >
                {alreadyTracked ? "✓ In tracked questions" : "+ Add to tracked questions"}
              </button>
              <button
                type="button"
                onClick={clearCheck}
                className="rounded-lg border border-edge bg-panel-2 px-3 py-1.5 text-xs font-medium text-muted transition hover:text-foreground"
              >
                Clear
              </button>
            </div>
          </div>

          {results.map((r) => {
            const label = ENGINES.find((e) => e.id === r.engine)?.label ?? r.engine;
            return (
              <div key={r.engine} className="glass rounded-2xl p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-foreground">{label}</h2>
                  {r.error ? (
                    <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600">
                      Couldn’t get an answer
                    </span>
                  ) : r.mentioned ? (
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      ✓ Named you
                    </span>
                  ) : (
                    <span className="rounded-full bg-panel-2 px-3 py-1 text-xs font-semibold text-muted">
                      ✗ Didn’t name you
                    </span>
                  )}
                </div>
                {!r.error && (
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
                    {renderAnswer(r.answer, companyTerms)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
