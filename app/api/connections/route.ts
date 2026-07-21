import { NextResponse } from "next/server";
import { connectionStatus, saveBoardBing, saveBoardGoogleAuth, saveGa4Property, saveGoogleClient } from "@/lib/connections";
import { ga4Sessions, getGoogleAccessToken, isoDay } from "@/lib/google";
import { listDestinations } from "@/lib/store";

export const dynamic = "force-dynamic";

// Connections are per board. When no board id is given (e.g. onboarding right after
// an OAuth round-trip), fall back to the newest board — that's the one just created.
async function resolveDestId(id?: string | null): Promise<string | undefined> {
  if (id) return id;
  const all = await listDestinations();
  return all[all.length - 1]?.id;
}

export async function GET(req: Request) {
  const destId = await resolveDestId(new URL(req.url).searchParams.get("dest"));
  return NextResponse.json(await connectionStatus(destId));
}

async function verifyBingKey(key: string): Promise<{ ok: boolean; sites?: string[]; message?: string }> {
  try {
    const res = await fetch(
      `https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) {
      return {
        ok: false,
        message:
          "Bing didn't accept this key. Double-check you copied the full API key from Settings → API access.",
      };
    }
    const data = (await res.json()) as { d?: { Url?: string }[] };
    const sites = (data.d ?? []).map((s) => s.Url ?? "").filter(Boolean);
    return { ok: true, sites };
  } catch {
    return { ok: false, message: "Couldn't reach Bing to verify the key. Please try again." };
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    bingApiKey?: string;
    ga4PropertyId?: string;
    destId?: string;
    googleClientId?: string;
    googleClientSecret?: string;
    googleDisconnect?: boolean;
  };
  const destId = await resolveDestId(body.destId);

  if (body.googleDisconnect) {
    if (!destId) return NextResponse.json({ message: "No board to disconnect." }, { status: 400 });
    // Forget this board's sign-in (tokens + account) but keep the one-time client setup.
    await saveBoardGoogleAuth(destId, null);
    return NextResponse.json(await connectionStatus(destId));
  }

  if (typeof body.googleClientId === "string" || typeof body.googleClientSecret === "string") {
    if (!body.googleClientId?.trim() || !body.googleClientSecret?.trim()) {
      return NextResponse.json(
        { message: "Please fill in both the Client ID and the Client secret." },
        { status: 400 }
      );
    }
    // The OAuth client (app setup) is the one shared piece — every board signs in through it.
    await saveGoogleClient(body.googleClientId.trim(), body.googleClientSecret.trim());
    return NextResponse.json(await connectionStatus(destId));
  }

  if (typeof body.bingApiKey === "string") {
    if (!destId) return NextResponse.json({ message: "No board to save this key to." }, { status: 400 });
    const key = body.bingApiKey.trim();
    if (key !== "") {
      const check = await verifyBingKey(key);
      if (!check.ok) return NextResponse.json({ message: check.message }, { status: 400 });
      await saveBoardBing(destId, key);
      return NextResponse.json({ ...(await connectionStatus(destId)), bingSites: check.sites });
    }
    await saveBoardBing(destId, ""); // disconnect
    return NextResponse.json(await connectionStatus(destId));
  }

  if (typeof body.ga4PropertyId === "string") {
    if (!destId) return NextResponse.json({ message: "No board to save this property to." }, { status: 400 });
    const id = body.ga4PropertyId.trim();
    if (id !== "") {
      if (!/^\d{5,15}$/.test(id)) {
        return NextResponse.json(
          { message: "A GA4 property ID is numbers only, like 345860521 — Google Analytics → Admin → Property details." },
          { status: 400 }
        );
      }
      const token = await getGoogleAccessToken(destId);
      if (token) {
        const probe = await ga4Sessions(id, token, isoDay(8), isoDay(1));
        if (!probe) {
          return NextResponse.json(
            {
              message:
                "Google Analytics didn't accept this property ID. Check the number in Admin → Property details, and that your signed-in Google account can view that property.",
            },
            { status: 400 }
          );
        }
      }
    }
    await saveGa4Property(destId, id);
    return NextResponse.json(await connectionStatus(destId));
  }

  return NextResponse.json({ message: "Nothing to save." }, { status: 400 });
}
