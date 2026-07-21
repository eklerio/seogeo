import { NextResponse } from "next/server";
import { suggestAliases } from "@/lib/ai";

export async function POST(req: Request) {
  let companyName: string;
  let url: string | undefined;
  try {
    ({ companyName, url } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  if (!companyName || !companyName.trim()) {
    return NextResponse.json({ aliases: [] });
  }

  try {
    const aliases = await suggestAliases(companyName.trim(), url);
    return NextResponse.json({ aliases });
  } catch {
    return NextResponse.json({ aliases: [] });
  }
}
