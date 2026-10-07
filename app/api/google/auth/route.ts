import { NextResponse } from "next/server";
import { getConnections } from "@/lib/connections";
import { GOOGLE_SCOPES, originFrom } from "@/lib/google";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = originFrom(req);
  const params = new URL(req.url).searchParams;
  const backParam = params.get("back");
  const back = backParam && /^\/(?![\/\\])/.test(backParam) ? backParam : "/workspace"; // "//x" would leave the site
  const dest = params.get("dest") ?? "";

  const { clientId } = (await getConnections()).googleClient ?? {};
  if (!clientId) {
    const dest = new URL(back, origin);
    dest.searchParams.set("google", "error");
    dest.searchParams.set("reason", "setup");
    return NextResponse.redirect(dest);
  }

  const state = crypto.randomUUID();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${origin}/api/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent"); // always returns a refresh token
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  const cookieOpts = { httpOnly: true, sameSite: "lax" as const, maxAge: 600, path: "/" };
  res.cookies.set("google_oauth_state", state, cookieOpts);
  res.cookies.set("google_oauth_back", back, cookieOpts);
  // Which board this sign-in belongs to; the callback falls back to the newest board.
  res.cookies.set("google_oauth_dest", dest, cookieOpts);
  return res;
}
