import { NextResponse } from "next/server";
import { readSite } from "@/lib/ai";

export async function POST(req: Request) {
  let url: string;
  try {
    ({ url } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error("bad protocol");
  } catch {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }

  try {
    const analysis = await readSite(url);
    return NextResponse.json(analysis);
  } catch (e) {
    return NextResponse.json(
      { error: "scan_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 502 }
    );
  }
}
