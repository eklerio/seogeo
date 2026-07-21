import { NextResponse } from "next/server";
import {
  addDestination,
  deleteDestination,
  listDestinations,
  updateDestination,
} from "@/lib/store";

export async function GET() {
  return NextResponse.json(await listDestinations());
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const url = String(body.url ?? "").trim();
  const companyName = String(body.companyName ?? "").trim();
  const questions = Array.isArray(body.questions) ? body.questions : [];

  if (!url || !companyName || questions.length === 0) {
    return NextResponse.json({ error: "missing_required" }, { status: 400 });
  }

  const dest = await addDestination({
    url,
    companyName,
    aliases: Array.isArray(body.aliases) ? (body.aliases as string[]) : [],
    country: String(body.country ?? "Worldwide (default market)"),
    language: String(body.language ?? "English"),
    summary: String(body.summary ?? ""),
    competitors: Array.isArray(body.competitors)
      ? (body.competitors as { name: string; url: string }[])
      : [],
    questions: questions as { text: string; type: "Commercial" | "Informational" }[],
    keywords: Array.isArray(body.keywords) ? (body.keywords as string[]) : [],
    keywordVolumes:
      body.keywordVolumes && typeof body.keywordVolumes === "object"
        ? (body.keywordVolumes as Record<string, number | null>)
        : {},
    ...(Array.isArray(body.engines) ? { engines: (body.engines as string[]).map(String) } : {}),
  });

  return NextResponse.json({ id: dest.id });
}

export async function PUT(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const id = String(body.id ?? "");
  const url = String(body.url ?? "").trim();
  const companyName = String(body.companyName ?? "").trim();
  const questions = Array.isArray(body.questions) ? body.questions : [];

  if (!id || !url || !companyName || questions.length === 0) {
    return NextResponse.json({ error: "missing_required" }, { status: 400 });
  }

  const updated = await updateDestination(id, {
    // Only touch the chatbot selection when the request actually sends one, so older
    // callers that omit it can't wipe a saved pick.
    ...(Array.isArray(body.engines) ? { engines: (body.engines as string[]).map(String) } : {}),
    url,
    companyName,
    aliases: Array.isArray(body.aliases) ? (body.aliases as string[]) : [],
    country: String(body.country ?? "Worldwide (default market)"),
    language: String(body.language ?? "English"),
    summary: String(body.summary ?? ""),
    competitors: Array.isArray(body.competitors)
      ? (body.competitors as { name: string; url: string }[])
      : [],
    questions: questions as { text: string; type: "Commercial" | "Informational" }[],
    keywords: Array.isArray(body.keywords) ? (body.keywords as string[]) : [],
    keywordVolumes:
      body.keywordVolumes && typeof body.keywordVolumes === "object"
        ? (body.keywordVolumes as Record<string, number | null>)
        : {},
  });

  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ id: updated.id });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const ok = await deleteDestination(id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const remaining = await listDestinations();
  return NextResponse.json({
    ok: true,
    nextBoardId: remaining.length ? remaining[remaining.length - 1].id : null,
  });
}
