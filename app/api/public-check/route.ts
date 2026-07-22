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

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
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

  const question = body?.question?.trim().slice(0, 300);
  const company = (body?.company ?? "").trim().slice(0, 120);
  const engines = (body?.engines ?? []).filter((e): e is EngineId =>
    (ALL_ENGINES as readonly string[]).includes(e)
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
