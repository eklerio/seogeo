import { boardConnections, getConnections, saveBoardGoogleAuth } from "./connections";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
].join(" ");

/** Public origin of the running app (works behind the cloudflare tunnel). */
export function originFrom(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = (await getConnections()).googleClient ?? {};
  if (!clientId || !clientSecret) throw new Error("Google client not configured");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
  return (await res.json()) as TokenResponse;
}

/** Valid access token for ONE board's Google sign-in, refreshing behind the scenes. Null when that board isn't signed in. */
export async function getGoogleAccessToken(destId: string): Promise<string | null> {
  const { googleClient } = await getConnections();
  const o = (await boardConnections(destId)).google;
  if (!o?.refreshToken || !googleClient?.clientId || !googleClient?.clientSecret) return null;
  if (o.accessToken && o.accessTokenExpiry && Date.parse(o.accessTokenExpiry) - Date.now() > 60_000) {
    return o.accessToken;
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: o.refreshToken,
      client_id: googleClient.clientId,
      client_secret: googleClient.clientSecret,
    }),
  });
  if (!res.ok) return null;
  const d = (await res.json()) as TokenResponse;
  await saveBoardGoogleAuth(destId, {
    accessToken: d.access_token,
    accessTokenExpiry: new Date(Date.now() + d.expires_in * 1000).toISOString(),
  });
  return d.access_token;
}

export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return ((await res.json()) as { email?: string }).email ?? null;
  } catch {
    return null;
  }
}

/** Search Console properties this Google account can read. */
export async function fetchGscSites(accessToken: string): Promise<string[]> {
  try {
    const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    const d = (await res.json()) as { siteEntry?: { siteUrl?: string }[] };
    return (d.siteEntry ?? []).map((s) => s.siteUrl ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

/* ---------- Real data: Search Console + Analytics ---------- */

export type GscTotals = { impressions: number; clicks: number };

export function isoDay(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Pick the Search Console property that matches a destination URL (sc-domain: or URL-prefix). */
export function matchGscSite(sites: string[], destUrl: string): string | null {
  let host: string;
  try {
    host = new URL(destUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  const domain = sites.find((s) => s === `sc-domain:${host}`);
  if (domain) return domain;
  return (
    sites.find((s) => {
      try {
        return new URL(s).hostname.replace(/^www\./, "") === host;
      } catch {
        return false;
      }
    }) ?? null
  );
}

export async function gscTotals(
  siteUrl: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<GscTotals | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate }),
      }
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { rows?: { impressions?: number; clicks?: number }[] };
    const row = d.rows?.[0];
    return { impressions: Math.round(row?.impressions ?? 0), clicks: Math.round(row?.clicks ?? 0) };
  } catch {
    return null;
  }
}

export type GscQuery = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number; // 0–1
  position: number;
};

/** The actual search terms people typed to find this site, from Search Console. */
export async function gscQueries(
  siteUrl: string,
  accessToken: string,
  startDate: string,
  endDate: string,
  rowLimit = 100
): Promise<GscQuery[] | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, dimensions: ["query"], rowLimit }),
      }
    );
    if (!res.ok) return null;
    const d = (await res.json()) as {
      rows?: { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }[];
    };
    return (d.rows ?? []).map((r) => ({
      query: r.keys?.[0] ?? "",
      clicks: Math.round(r.clicks ?? 0),
      impressions: Math.round(r.impressions ?? 0),
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    }));
  } catch {
    return null;
  }
}

export type Ga4Sessions = { total: number; bySource: { source: string; sessions: number }[] };

export async function ga4Sessions(
  propertyId: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<Ga4Sessions | null> {
  try {
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: "sessionSource" }],
          metrics: [{ name: "sessions" }],
          limit: "10000",
        }),
      }
    );
    if (!res.ok) return null;
    const d = (await res.json()) as {
      rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
    };
    const bySource = (d.rows ?? []).map((r) => ({
      source: r.dimensionValues?.[0]?.value ?? "(unknown)",
      sessions: Number(r.metricValues?.[0]?.value ?? 0),
    }));
    return { total: bySource.reduce((s, r) => s + r.sessions, 0), bySource };
  } catch {
    return null;
  }
}

export type Ga4AiPage = { page: string; sessions: number; sources: string[] };

/** Pages that visitors coming from AI tools (ChatGPT, Perplexity, …) landed on. */
export async function ga4AiLandingPages(
  propertyId: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<Ga4AiPage[] | null> {
  try {
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: "landingPagePlusQueryString" }, { name: "sessionSource" }],
          metrics: [{ name: "sessions" }],
          limit: "10000",
        }),
      }
    );
    if (!res.ok) return null;
    const d = (await res.json()) as {
      rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
    };
    const byPage = new Map<string, { sessions: number; sources: Set<string> }>();
    for (const r of d.rows ?? []) {
      const source = r.dimensionValues?.[1]?.value ?? "";
      if (!isAiSource(source)) continue;
      const page = r.dimensionValues?.[0]?.value || "/";
      const sessions = Number(r.metricValues?.[0]?.value ?? 0);
      if (!sessions) continue;
      const cur = byPage.get(page) ?? { sessions: 0, sources: new Set<string>() };
      cur.sessions += sessions;
      cur.sources.add(source.replace(/^www\./, ""));
      byPage.set(page, cur);
    }
    return [...byPage.entries()]
      .map(([page, v]) => ({ page, sessions: v.sessions, sources: [...v.sources] }))
      .sort((a, b) => b.sessions - a.sessions);
  } catch {
    return null;
  }
}

// Referrer domains that mean "a human clicked out of an AI answer".
const AI_SOURCE_PATTERNS = [
  "chatgpt",
  "chat.openai",
  "openai.com",
  "perplexity",
  "gemini.google",
  "bard.google",
  "copilot.microsoft",
  "claude.ai",
  "anthropic.com",
  "you.com",
  "phind.com",
];

export function isAiSource(source: string): boolean {
  const s = source.toLowerCase();
  return AI_SOURCE_PATTERNS.some((p) => s.includes(p));
}
