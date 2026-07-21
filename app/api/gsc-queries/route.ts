import { NextResponse } from "next/server";
import { boardConnections } from "@/lib/connections";
import { getGoogleAccessToken, gscQueries, isoDay, matchGscSite } from "@/lib/google";
import { listDestinations } from "@/lib/store";

export const dynamic = "force-dynamic";

// Free, live: the real search terms people typed to find this site (Search Console).
// No DataForSEO spend. Last 28 days, ending ~3 days back (Search Console lags).
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const all = await listDestinations();
  const dest = id ? all.find((d) => d.id === id) : all[all.length - 1];
  if (!dest) return NextResponse.json({ message: "No destination" }, { status: 404 });

  const [board, token] = await Promise.all([boardConnections(dest.id), getGoogleAccessToken(dest.id)]);
  if (!token) {
    return NextResponse.json({ googleConnected: false, siteUrl: null, queries: null });
  }

  const siteUrl = matchGscSite(board.google?.sites ?? [], dest.url);
  if (!siteUrl) {
    return NextResponse.json({ googleConnected: true, siteUrl: null, queries: null });
  }

  const raw = await gscQueries(siteUrl, token, isoDay(31), isoDay(3), 250);
  const filtered = (raw ?? [])
    .filter((q) => !looksLikeNoise(q.query))
    // Drop statistical noise: a term with no clicks and barely any impressions is a one-off
    // fluke (often a bot). "Position 1" off a single impression isn't a real ranking.
    .filter((q) => q.clicks >= 1 || q.impressions >= 3);
  const queries = filtered.slice(0, 100);
  // Totals cover ALL real phrases, not just the 100 rows we list; hitCap means Google
  // had even more beyond the 250 we asked for.
  return NextResponse.json({
    googleConnected: true,
    siteUrl,
    queries,
    totalTerms: filtered.length,
    totalClicks: filtered.reduce((s, q) => s + q.clicks, 0),
    totalImpressions: filtered.reduce((s, q) => s + q.impressions, 0),
    hitCap: (raw ?? []).length >= 250,
  });
}

// Search Console surfaces a lot of machine noise (indexed hashes, wallet/contract addresses,
// code snippets, gibberish tokens). These are never real "what people Googled to find you",
// so we hide them. Real search phrases are made of short, mostly-alphabetic words.
function looksLikeNoise(query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (/^\d+$/.test(q)) return true; // pure numbers ("1", "306") are never a real search
  if (q.includes('"')) return true; // quoted hash/code searches
  if (q.length > 60) return true; // pathologically long
  for (const t of q.split(/\s+/)) {
    if (t.length >= 20) return true; // no real search word is 20+ chars (addresses, base58, hashes)
    if (/[0-9a-f]{16,}/i.test(t)) return true; // long hex hash
    if (t.includes("_") && t.length >= 10) return true; // snake_case ids
    if (t.length >= 15 && /\d/.test(t) && /[a-z]/i.test(t)) return true; // long letter+digit id
  }
  return false;
}
