"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ALL_ENGINES, ENGINE_LABEL, type EngineId } from "@/lib/engines";

const ENGINES = ALL_ENGINES.map((id) => ({ id, label: ENGINE_LABEL[id] }));

/* Palette (Caldera structure, Glinton colors): canvas gray #e5e5e2, card
   off-white #f7f7f4, lime #a3e635 (the only chromatic accent), graphite
   #0b0b0a, white. Flat — no shadows, hierarchy by surface color. */

/* Fade + rise on scroll into view. One-shot; observer disconnects after. */
function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add("is-in");
            io.unobserve(el);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`lg-reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

type Result = { engine: EngineId; answer: string; mentioned: boolean; error: boolean };

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightNames(text: string, terms: string[]): React.ReactNode {
  const company = terms.map((t) => t.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!company.length) return text;
  const re = new RegExp(`(?<![\\w])(${company.map(escapeRe).join("|")})(?![\\w])`, "gi");
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-transparent px-0.5 font-semibold text-[#a3e635]">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function renderBold(text: string, terms: string[]): React.ReactNode {
  return text.split(/\*\*([^*\n]+)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-white">
        {highlightNames(part, terms)}
      </strong>
    ) : (
      <Fragment key={i}>{highlightNames(part, terms)}</Fragment>
    )
  );
}

function renderAnswer(text: string, terms: string[]): React.ReactNode {
  const parts = text.split(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g);
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    nodes.push(<Fragment key={`t${i}`}>{renderBold(parts[i], terms)}</Fragment>);
    if (i + 2 < parts.length) {
      nodes.push(
        <a
          key={`a${i}`}
          href={parts[i + 2]}
          target="_blank"
          rel="noreferrer"
          className="break-all text-white underline decoration-[#a3e635] decoration-2 underline-offset-2"
        >
          {parts[i + 1]}
        </a>
      );
    }
  }
  return nodes;
}

/* ── Live public check ─────────────────────────────────────────────────── */
function PublicCheck({ onRequestDemo }: { onRequestDemo: () => void }) {
  const [company, setCompany] = useState("");
  const [question, setQuestion] = useState("");
  const [selected, setSelected] = useState<EngineId[]>([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [ranQuestion, setRanQuestion] = useState("");
  const [ranCompany, setRanCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);

  const canRun = question.trim().length > 3 && selected.length > 0 && !running;

  function toggle(e: EngineId) {
    setSelected((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));
  }

  async function run() {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    setResults(null);
    setLimited(false);
    try {
      const res = await fetch("/api/public-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), company: company.trim(), engines: selected }),
      });
      if (res.status === 429) {
        const d = await res.json().catch(() => null);
        setLimited(true);
        setError(d?.message ?? "You've reached today's free-check limit.");
        return;
      }
      if (!res.ok) throw new Error();
      const d = (await res.json()) as { results: Result[] };
      setResults(d.results);
      setRanQuestion(question.trim());
      setRanCompany(company.trim());
    } catch {
      setError("Something went wrong asking the AIs — try again in a moment.");
    } finally {
      setRunning(false);
    }
  }

  const terms = ranCompany ? [ranCompany] : [];

  const inputCls =
    "mt-2 w-full border-[1.5px] border-white/15 bg-white/[0.06] px-5 py-3.5 text-white outline-none transition placeholder:text-white/35 focus:border-[#a3e635]";

  return (
    <div className="relative overflow-hidden bg-[#0b0b0a] px-6 py-10 sm:px-14 sm:py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(80% 120% at 90% -10%, rgba(163,230,53,0.16), transparent 60%)",
        }}
      />
      <div className="relative">
      <div className="mb-8 max-w-2xl">
        <span className="inline-block bg-[#a3e635] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[#0b0b0a]">
          First 3 checks free
        </span>
        <h2 className="landing-display mt-3 text-[clamp(30px,3.6vw,46px)] leading-none text-white">Try it now</h2>
        <p className="mt-4 text-base leading-snug text-white/60">
          Ask any AI assistant a buyer question and see whether it names your company - live
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm text-white/70">Your company name</label>
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Hexens" className={inputCls} />
        </div>
        <div>
          <label className="text-sm text-white/70">A question a buyer might ask</label>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                run();
              }
            }}
            placeholder="e.g. Best web3 security audit companies?"
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="text-sm text-white/60">Ask:</span>
        {ENGINES.map((e) => {
          const on = selected.includes(e.id);
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => toggle(e.id)}
              className={`px-4 py-2 text-sm transition ${
                on ? "bg-[#a3e635] text-[#0b0b0a]" : "bg-white/10 text-white/70 hover:text-white"
              }`}
            >
              {on ? "✓ " : ""}
              {e.label}
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={run}
          disabled={!canRun}
          className={`px-7 py-3.5 text-base transition ${
            canRun ? "bg-[#a3e635] text-[#0b0b0a] hover:brightness-95" : "bg-white/10 text-white/40"
          }`}
        >
          {running ? "Checking…" : "Check my visibility"}
        </button>
        <span className="text-sm text-white/60">
          {selected.length === 0 ? "Pick at least one assistant above." : "Live results, free to try."}
        </span>
      </div>

      {error && (
        <div className="mt-5 bg-white/[0.06] px-5 py-4 text-sm">
          <p className="font-semibold text-white">{error}</p>
          {limited && (
            <button
              type="button"
              onClick={onRequestDemo}
              className="mt-2 bg-[#a3e635] px-4 py-2 text-sm text-[#0b0b0a]"
            >
              Request a demo →
            </button>
          )}
        </div>
      )}

      {running && (
        <div className="mt-5 flex items-center gap-4 bg-white/[0.06] px-5 py-4">
          <div className="relative h-7 w-7 shrink-0">
            <div className="absolute inset-0 border-[3px] border-white/15" />
            <div className="absolute inset-0 animate-spin border-[3px] border-transparent border-t-[#a3e635]" />
          </div>
          <p className="text-sm text-white/60">
            Asking {selected.map((e) => ENGINE_LABEL[e]).join(" and ")} — usually 10–30 seconds.
          </p>
        </div>
      )}

      {results && (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-white/60">
            Results for <span className="font-semibold text-white">“{ranQuestion}”</span>
          </p>
          {results.map((r) => (
            <div key={r.engine} className="bg-white/[0.06] p-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="landing-display text-[26px] text-white">{ENGINE_LABEL[r.engine]}</h3>
                {r.error ? (
                  <span className="bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white/70">
                    Couldn’t get an answer
                  </span>
                ) : !ranCompany ? null : r.mentioned ? (
                  <span className="bg-[#a3e635] px-3.5 py-1.5 text-xs font-semibold text-[#0b0b0a]">
                    ✓ Named you
                  </span>
                ) : (
                  <span className="bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white/50">
                    ✗ Didn’t name you
                  </span>
                )}
              </div>
              {!r.error && (
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/85">
                  {renderAnswer(r.answer, terms)}
                </p>
              )}
            </div>
          ))}
          <div className="bg-[#a3e635]/15 px-6 py-5 text-sm text-white">
            This is one question. Glinton tracks dozens every week across ChatGPT, Gemini, Claude and
            Perplexity — and tells you how to climb.{" "}
            <button type="button" onClick={onRequestDemo} className="font-semibold underline decoration-2 underline-offset-2">
              Request a demo →
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

/* ── Request-demo modal ────────────────────────────────────────────────── */
function DemoModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", company: "", website: "", note: "" });
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    setError(null);
    if (!form.name.trim() || !form.email.trim() || !form.company.trim()) {
      setError("Name, email and company are required.");
      return;
    }
    setState("sending");
    try {
      const res = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.message ?? "Something went wrong.");
      }
      setState("done");
    } catch (e) {
      setState("idle");
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  const inputCls =
    "mt-1.5 w-full border-[1.5px] border-transparent bg-white px-5 py-3 text-[#0b0b0a] outline-none transition focus:border-[#0b0b0a]";

  return (
    <div className="landing-body fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto bg-[#f7f7f4] p-7 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {state === "done" ? (
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center bg-[#a3e635] text-2xl text-[#0b0b0a]">
              ✓
            </div>
            <h2 className="landing-display mt-5 text-[32px] text-[#0b0b0a]">Thanks — we got it</h2>
            <p className="mt-3 text-sm text-[#0b0b0a]/60">
              We’ll reach out at <span className="font-semibold text-[#0b0b0a]">{form.email}</span> to set up your demo.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-7 w-full bg-[#0b0b0a] py-3.5 text-white transition hover:bg-[#0b0b0a]/85"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="landing-display text-[32px] text-[#0b0b0a]">Request a demo</h2>
                <p className="mt-1.5 text-sm text-[#0b0b0a]/60">See your full AI visibility, live. No commitment.</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-[#0b0b0a]/50 hover:text-[#0b0b0a]"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mt-6 space-y-3">
              {(
                [
                  ["name", "Your name", "Jane Doe"],
                  ["email", "Work email", "jane@company.com"],
                  ["company", "Company", "Acme Inc."],
                  ["website", "Website (optional)", "acme.com"],
                ] as const
              ).map(([k, label, ph]) => (
                <div key={k}>
                  <label className="text-sm text-[#0b0b0a]/70">{label}</label>
                  <input value={form[k]} onChange={set(k)} placeholder={ph} className={inputCls} />
                </div>
              ))}
              <div>
                <label className="text-sm text-[#0b0b0a]/70">Anything you want us to know? (optional)</label>
                <textarea
                  value={form.note}
                  onChange={set("note")}
                  rows={3}
                  className="mt-1.5 w-full resize-none border-[1.5px] border-transparent bg-white px-5 py-3 text-[#0b0b0a] outline-none transition focus:border-[#0b0b0a]"
                />
              </div>
            </div>

            {error && <p className="mt-3 text-sm font-semibold text-[#0b0b0a]">{error}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={state === "sending"}
              className="mt-6 w-full bg-[#a3e635] py-3.5 text-[#0b0b0a] transition hover:brightness-95 disabled:opacity-60"
            >
              {state === "sending" ? "Sending…" : "Request demo"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */
const FEATURES = [
  {
    tag: "Weekly tracking",
    title: "AI Share of Voice",
    body: "See how often ChatGPT, Gemini, Claude and Perplexity name you vs your competitors — measured on real answers, every week.",
  },
  {
    tag: "Competitors",
    title: "Beat your competitors",
    body: "Ranked side-by-side by estimated Google traffic and AI mentions, with the exact keywords they win that you don’t.",
  },
  {
    tag: "Real numbers",
    title: "Real visits from AI",
    body: "Connect Analytics and see actual visitors arriving from ChatGPT, Perplexity and friends — the metric that proves it’s working.",
  },
  {
    tag: "Action plan",
    title: "Your next moves",
    body: "A short, prioritized action list written from your own numbers — concrete steps to climb, no fluff, no overpromising.",
  },
];

const STEPS = [
  ["1", "Tell us your site", "We scan it, find your competitors, and build the questions buyers actually ask."],
  ["2", "We ask the AIs weekly", "Live answers from every major AI assistant, scored for whether they recommend you."],
  ["3", "You get a plan", "A clear report plus the next moves to get named more often — and win the buyers."],
] as const;

export default function Landing() {
  const [demoOpen, setDemoOpen] = useState(false);
  const openDemo = () => setDemoOpen(true);

  const scrollToId = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const target = document.getElementById(id);
    if (!target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const scrollToTop = (e: React.MouseEvent) => {
    e.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  const NAV_LINKS = [
    { id: "check", label: "Try it free" },
    { id: "features", label: "Features" },
    { id: "how", label: "How it works" },
  ];

  return (
    <div className="landing-body min-h-screen bg-[#e5e5e2] text-[#0b0b0a]">
      {/* Nav — items live inside an off-white pill, Caldera-style */}
      <header className="sticky top-0 z-40 bg-[#e5e5e2]/95 backdrop-blur-sm">
        <div className="mx-auto max-w-[1280px] px-5 py-4">
          <div className="flex items-center justify-between bg-[#f7f7f4] py-2 pl-5 pr-2">
            <a href="#" onClick={scrollToTop} className="flex items-center">
              <img src="/glinton-outline.png" alt="Glinton" className="h-7 w-auto" />
            </a>
            <nav className="hidden items-center gap-1 md:flex">
              {NAV_LINKS.map((l) => (
                <a
                  key={l.id}
                  href={`#${l.id}`}
                  onClick={scrollToId(l.id)}
                  className="px-4 py-2 text-sm text-[#0b0b0a]/70 transition hover:text-[#0b0b0a]"
                >
                  {l.label}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-1">
              <a
                href="/workspace"
                className="hidden px-4 py-2 text-sm text-[#0b0b0a]/70 transition hover:text-[#0b0b0a] sm:inline"
              >
                Log in
              </a>
              <button
                type="button"
                onClick={openDemo}
                className="bg-[#a3e635] px-5 py-2.5 text-sm text-[#0b0b0a] transition hover:brightness-95"
              >
                Request demo
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero — architectural display type on the raw canvas, no decoration */}
      <section className="mx-auto max-w-[1280px] px-5 pb-20 pt-14 sm:pt-20">
        <Reveal>
          <h1 className="landing-display text-[clamp(40px,6.5vw,96px)] text-[#0b0b0a]" style={{ lineHeight: 1.12 }}>
            Do AI assistants
            <br />
            recommend <span className="text-[#a3e635]">your</span> company?
          </h1>
        </Reveal>
        <Reveal className="mt-8 flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between" delay={90}>
          <p className="max-w-xl text-base leading-relaxed text-[#0b0b0a]/70 sm:text-lg">
            Buyers now ask AI for recommendations. Glinton shows whether they name you, how you rank
            against competitors, and exactly what to do about it.
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={openDemo}
              className="bg-[#a3e635] px-7 py-3.5 text-[#0b0b0a] transition hover:brightness-95"
            >
              Request demo
            </button>
            <a
              href="#check"
              onClick={scrollToId("check")}
              className="border-[1.5px] border-[#0b0b0a] px-7 py-3.5 text-[#0b0b0a] transition hover:bg-[#0b0b0a] hover:text-white"
            >
              Try the free check ↓
            </a>
          </div>
        </Reveal>
      </section>

      {/* Instant check — dark card on the canvas, title lives inside it */}
      <section id="check" className="mx-auto max-w-[1280px] scroll-mt-24 px-5 pb-20">
        <Reveal>
          <PublicCheck onRequestDemo={openDemo} />
        </Reveal>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-[1280px] scroll-mt-24 px-5 pb-20">
        <Reveal>
          <h2 className="landing-display text-[clamp(40px,5.5vw,64px)] text-[#0b0b0a]">
            Everything you need
            <br />
            to win in AI search
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} className="bg-[#f7f7f4] p-8 sm:p-10" delay={i * 70}>
              <span className="inline-block bg-[#a3e635]/25 px-3.5 py-1 text-xs text-[#0b0b0a]">{f.tag}</span>
              <h3 className="landing-display mt-5 text-[32px] tracking-[0.02em] text-[#0b0b0a]">{f.title}</h3>
              <p className="mt-3 text-base leading-relaxed text-[#0b0b0a]/65">{f.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* How it works — lime feature cards, the loudest surfaces on the page */}
      <section id="how" className="mx-auto max-w-[1280px] scroll-mt-24 px-5 pb-20">
        <Reveal>
          <h2 className="landing-display text-[clamp(40px,5.5vw,64px)] text-[#0b0b0a]">How it works</h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {STEPS.map(([n, title, body], i) => (
            <Reveal
              key={n}
              className="group bg-[#a3e635] p-8 transition-[colors,transform] duration-200 hover:-translate-y-1 hover:bg-[#0b0b0a] sm:p-10"
              delay={i * 90}
            >
              <span className="landing-display block text-[80px] leading-none text-[#0b0b0a] transition-colors duration-200 group-hover:text-[#a3e635]">
                {n}
              </span>
              <h3 className="mt-6 text-lg text-[#0b0b0a] transition-colors duration-200 group-hover:text-white">
                {title}
              </h3>
              <p className="mt-2 text-base leading-relaxed text-[#0b0b0a]/70 transition-colors duration-200 group-hover:text-white/70">
                {body}
              </p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Final CTA — dark card with halftone corner */}
      <section className="mx-auto max-w-[1280px] px-5 pb-20">
        <Reveal className="relative overflow-hidden bg-[#0b0b0a] px-8 py-16 text-center sm:px-14 sm:py-24">
          <div
            aria-hidden
            className="landing-halftone pointer-events-none absolute inset-0"
            style={{
              WebkitMaskImage: "radial-gradient(70% 90% at 100% 100%, #000 20%, transparent 70%)",
              maskImage: "radial-gradient(70% 90% at 100% 100%, #000 20%, transparent 70%)",
              opacity: 0.7,
            }}
          />
          <div className="relative">
            <h2 className="landing-display mx-auto max-w-3xl text-[clamp(44px,7vw,96px)] text-white">
              See your full <span className="text-[#a3e635]">AI visibility</span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base text-white/60">
              Book a demo and we’ll show you where you stand across every major AI assistant — and how to climb.
            </p>
            <button
              type="button"
              onClick={openDemo}
              className="mt-9 bg-[#a3e635] px-9 py-4 text-[#0b0b0a] transition hover:brightness-95"
            >
              Request demo
            </button>
          </div>
        </Reveal>
      </section>

      <footer className="mx-auto max-w-[1280px] px-5 pb-10">
        <div className="landing-dotted-divider flex flex-col items-center justify-between gap-3 pt-8 text-sm text-[#0b0b0a]/60 sm:flex-row">
          <span>© {new Date().getFullYear()} Glinton</span>
          <a href="/workspace" className="hover:text-[#0b0b0a]">
            Log in
          </a>
        </div>
      </footer>

      {demoOpen && <DemoModal onClose={() => setDemoOpen(false)} />}
    </div>
  );
}
