import { NextResponse } from "next/server";
import { saveBoardGoogleAuth } from "@/lib/connections";
import { exchangeCode, fetchGoogleEmail, fetchGscSites, originFrom } from "@/lib/google";
import { listDestinations } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = originFrom(req);
  const url = new URL(req.url);
  const cookies = req.headers.get("cookie") ?? "";
  const rawBack = cookies.match(/(?:^|;\s*)google_oauth_back=([^;]+)/)?.[1];
  const back = rawBack ? decodeURIComponent(rawBack) : "/workspace";
  const backPath = back.startsWith("/") ? back : "/workspace";
  const destCookie = cookies.match(/(?:^|;\s*)google_oauth_dest=([^;]+)/)?.[1];

  const redirectTo = (params: Record<string, string>) => {
    const dest = new URL(backPath, origin);
    for (const [k, v] of Object.entries(params)) dest.searchParams.set(k, v);
    const res = NextResponse.redirect(dest);
    res.cookies.delete("google_oauth_state");
    res.cookies.delete("google_oauth_back");
    res.cookies.delete("google_oauth_dest");
    return res;
  };
  const fail = (reason: string) => redirectTo({ google: "error", reason });

  if (url.searchParams.get("error")) return fail(url.searchParams.get("error")!);

  const code = url.searchParams.get("code");
  if (!code) return fail("no_code");

  const state = url.searchParams.get("state");
  const cookieState = cookies.match(/(?:^|;\s*)google_oauth_state=([^;]+)/)?.[1];
  if (!state || !cookieState || state !== cookieState) return fail("state_mismatch");

  try {
    // Sign-ins are per board. No cookie (e.g. onboarding lost it) → the newest board.
    const destId = destCookie ? decodeURIComponent(destCookie) : (await listDestinations()).at(-1)?.id;
    if (!destId) return fail("no_board");

    const tokens = await exchangeCode(code, `${origin}/api/google/callback`);
    const [email, sites] = await Promise.all([
      fetchGoogleEmail(tokens.access_token),
      fetchGscSites(tokens.access_token),
    ]);
    await saveBoardGoogleAuth(destId, {
      refreshToken: tokens.refresh_token ?? "",
      accessToken: tokens.access_token,
      accessTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      email: email ?? "",
      sites,
    });
    if (!tokens.refresh_token) return fail("no_refresh_token");
    return redirectTo({ google: "ok" });
  } catch {
    return fail("exchange_failed");
  }
}
