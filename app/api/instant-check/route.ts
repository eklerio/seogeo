import { NextResponse } from "next/server";
import { llmAnswer } from "@/lib/dataforseo";
import { listDestinations } from "@/lib/store";
import { ALL_ENGINES, type EngineId } from "@/lib/engines";

export const dynamic = "force-dynamic";

const ENGINES = ALL_ENGINES;
type Engine = EngineId;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isNamedIn(text: string, terms: string[]): boolean {
  const cleaned = terms.map((t) => t.trim()).filter(Boolean);
  if (!cleaned.length) return false;
  const re = new RegExp(`(?<![\\w])(?:${cleaned.map(escapeRe).join("|")})(?![\\w])`, "i");
  return re.test(text);
}

// One-off "am I in this AI answer?" check — asks the live engines, no caching, no snapshots.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    destId?: string;
    question?: string;
    engines?: string[];
  } | null;

  const question = body?.question?.trim();
  const engines = (body?.engines ?? []).filter((e): e is Engine =>
    (ENGINES as readonly string[]).includes(e)
  );
  if (!question || !engines.length) {
    return NextResponse.json({ message: "Question and at least one AI required" }, { status: 400 });
  }

  const dest = (await listDestinations()).find((d) => d.id === body?.destId);
  if (!dest) return NextResponse.json({ message: "Board not found" }, { status: 404 });

  const companyTerms = [dest.companyName, ...dest.aliases];

  const results = await Promise.all(
    engines.map(async (engine) => {
      try {
        const answer = await llmAnswer(engine, question);
        return { engine, answer, mentioned: isNamedIn(answer, companyTerms), error: false };
      } catch {
        return { engine, answer: "", mentioned: false, error: true };
      }
    })
  );

  return NextResponse.json({ results });
}
