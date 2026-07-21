import { NextResponse } from "next/server";
import type { Destination } from "@/lib/store";
import { estimateNextRun, estimateRunCosts } from "@/lib/report";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let dest: Destination;
  try {
    dest = (await req.json()) as Destination;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  // Saved destination → price the next run against its warm/cold caches.
  if (dest?.id) {
    return NextResponse.json(await estimateNextRun(dest));
  }
  // Unsaved setup form → price purely from the counts being edited.
  return NextResponse.json(
    estimateRunCosts({
      url: dest?.url ?? "",
      questions: Array.isArray(dest?.questions) ? dest.questions : [],
      keywords: Array.isArray(dest?.keywords) ? dest.keywords : [],
      competitors: Array.isArray(dest?.competitors) ? dest.competitors : [],
      engines: Array.isArray(dest?.engines) ? dest.engines : undefined,
    })
  );
}
