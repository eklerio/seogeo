import { NextResponse } from "next/server";
import { llmAnswer } from "@/lib/dataforseo";
import { ALL_ENGINES, type EngineId } from "@/lib/engines";

export const dynamic = "force-dynamic";

// Public endpoint = real DataForSEO spend on every run, so guard it: each visitor IP gets a
// limited number of checks per rolling window. In-memory is fine for a single server; a
// restart resets the counters (acceptable for a demo landing).
const MAX_CHECKS = 5;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const hits = new Map<string, number[]>();

// Cloudflare sets cf-connecting-ip itself, so it can't be faked. x-forwarded-for can: Cloudflare
// appends to whatever the visitor sent, so only its LAST entry is trustworthy.
function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",").pop()!.trim();
  return "unknown";
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  // Drop expired visitors so the map can't grow forever.
  if (hits.size > 10_000) {
    for (const [k, ts] of hits) if (!ts.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  }
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_CHECKS) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isNamedIn(text: string, terms: string[]): boolean {
  const cleaned = terms.map((t) => t.trim()).filter(Boolean);
  if (!cleaned.length) return false;
  const re = new RegExp(`(?<![\\w])(?:${cleaned.map(escapeRe).join("|")})(?![\\w])`, "i");
  return re.test(text);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    question?: string;
    company?: string;
    engines?: string[];
  } | null;

  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 300) : "";
  const company = typeof body?.company === "string" ? body.company.trim().slice(0, 120) : "";
  // Each chatbot at most once — a repeated name would otherwise mean a repeated paid call.
  const engines = [...new Set(Array.isArray(body?.engines) ? body.engines : [])].filter(
    (e): e is EngineId => (ALL_ENGINES as readonly string[]).includes(e)
  );

  if (!question || question.length < 4 || !engines.length) {
    return NextResponse.json(
      { message: "Type a question and pick at least one AI." },
      { status: 400 }
    );
  }

  if (rateLimited(clientIp(req))) {
    return NextResponse.json(
      { message: "You've hit today's free-check limit. Request a demo to see the full tool." },
      { status: 429 }
    );
  }

  const companyTerms = company ? [company] : [];

  const results = await Promise.all(
    engines.map(async (engine) => {
      try {
        const answer = await llmAnswer(engine, question);
        return {
          engine,
          answer,
          mentioned: companyTerms.length ? isNamedIn(answer, companyTerms) : false,
          error: false,
        };
      } catch {
        return { engine, answer: "", mentioned: false, error: true };
      }
    })
  );

  return NextResponse.json({ results, scored: companyTerms.length > 0 });
}
