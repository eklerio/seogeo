import { NextResponse } from "next/server";
import { boardConnections } from "@/lib/connections";
import {
  ga4AiLandingPages,
  ga4Sessions,
  getGoogleAccessToken,
  gscTotals,
  isAiSource,
  isoDay,
  matchGscSite,
} from "@/lib/google";
import { listDestinations } from "@/lib/store";

export const dynamic = "force-dynamic";

// Free, live "reality check" numbers for the Overview: real Google impressions/clicks
// (Search Console) and real visits incl. AI referrals (GA4). No DataForSEO spend.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const all = await listDestinations();
  const dest = id ? all.find((d) => d.id === id) : all[all.length - 1];
  if (!dest) return NextResponse.json({ message: "No destination" }, { status: 404 });

  const [board, token] = await Promise.all([boardConnections(dest.id), getGoogleAccessToken(dest.id)]);
  const propertyId = board.ga4PropertyId ?? null;

  if (!token) {
    return NextResponse.json({
      googleConnected: false,
      gsc: null,
      ga4: { propertyIdSet: !!propertyId, data: null },
    });
  }

  const siteUrl = matchGscSite(board.google?.sites ?? [], dest.url);

  // Search Console lags ~2-3 days, so its 7-day window ends 3 days ago. GA4 is fresh to yesterday.
  const gscCurRange = [isoDay(9), isoDay(3)] as const;
  const gscPrevRange = [isoDay(16), isoDay(10)] as const;
  const ga4CurRange = [isoDay(7), isoDay(1)] as const;
  const ga4PrevRange = [isoDay(14), isoDay(8)] as const;

  const [gscCur, gscPrev, ga4Cur, ga4Prev, aiPages] = await Promise.all([
    siteUrl ? gscTotals(siteUrl, token, ...gscCurRange) : null,
    siteUrl ? gscTotals(siteUrl, token, ...gscPrevRange) : null,
    propertyId ? ga4Sessions(propertyId, token, ...ga4CurRange) : null,
    propertyId ? ga4Sessions(propertyId, token, ...ga4PrevRange) : null,
    propertyId ? ga4AiLandingPages(propertyId, token, ...ga4CurRange) : null,
  ]);

  const aiBreakdown = (s: { source: string; sessions: number }[] | undefined) =>
    (s ?? [])
      .filter((r) => isAiSource(r.source) && r.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions);

  const curAi = aiBreakdown(ga4Cur?.bySource);
  const prevAi = aiBreakdown(ga4Prev?.bySource);

  return NextResponse.json({
    googleConnected: true,
    gsc:
      siteUrl && gscCur
        ? {
            siteUrl,
            current: gscCur,
            previous: gscPrev,
          }
        : null,
    ga4: {
      propertyIdSet: !!propertyId,
      data: ga4Cur
        ? {
            current: {
              visits: ga4Cur.total,
              aiVisits: curAi.reduce((s, r) => s + r.sessions, 0),
              aiSources: curAi.slice(0, 5),
              aiPages: (aiPages ?? []).slice(0, 10),
            },
            previous: ga4Prev
              ? { visits: ga4Prev.total, aiVisits: prevAi.reduce((s, r) => s + r.sessions, 0) }
              : null,
          }
        : null,
    },
  });
}
