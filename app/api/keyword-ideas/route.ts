import { NextResponse } from "next/server";
import { keywordIdeas, keywordMetrics } from "@/lib/dataforseo";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // Lookup mode: monthly volumes for an existing list of phrases (edit screen).
  if (Array.isArray(body.lookup)) {
    const phrases = (body.lookup as unknown[]).map((p) => String(p)).filter(Boolean);
    try {
      const metrics = await keywordMetrics(phrases);
      const volumes: Record<string, number | null> = {};
      for (const p of phrases) {
        volumes[p] = metrics[p.toLowerCase()]?.searchVolume ?? null;
      }
      return NextResponse.json({ volumes });
    } catch {
      return NextResponse.json({ volumes: {} });
    }
  }

  // Ideas mode: industry top phrases seeded from company keywords.
  const seeds = Array.isArray(body.seeds) ? (body.seeds as unknown[]).map((s) => String(s)) : [];
  if (!seeds.length) {
    return NextResponse.json({ ideas: [] });
  }
  try {
    const ideas = await keywordIdeas(seeds);
    return NextResponse.json({ ideas });
  } catch {
    return NextResponse.json({ ideas: [] });
  }
}
