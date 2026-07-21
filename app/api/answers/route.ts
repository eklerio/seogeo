import { NextResponse } from "next/server";
import { getActiveDestination, listDestinations } from "@/lib/store";
import { cachedAnswersFor } from "@/lib/report";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const dest = id
    ? ((await listDestinations()).find((d) => d.id === id) ?? null)
    : await getActiveDestination();
  if (!dest) return NextResponse.json({ error: "no_destination" }, { status: 404 });
  return NextResponse.json(await cachedAnswersFor(dest));
}
