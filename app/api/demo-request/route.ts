import { NextResponse } from "next/server";
import { saveDemoRequest } from "@/lib/demo";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    email?: string;
    company?: string;
    website?: string;
    note?: string;
  } | null;

  const name = clip(body?.name, 120);
  const email = clip(body?.email, 160);
  const company = clip(body?.company, 160);
  const website = clip(body?.website, 200);
  const note = clip(body?.note, 1000);

  if (!name || !email || !company) {
    return NextResponse.json({ message: "Name, email and company are required." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ message: "Please enter a valid email address." }, { status: 400 });
  }

  await saveDemoRequest({ ts: new Date().toISOString(), name, email, company, website, note });
  return NextResponse.json({ ok: true });
}
