"use client";

import { useCallback, useEffect, useState } from "react";

type Status = {
  bing: { connected: boolean; maskedKey: string | null };
  google: {
    connected: boolean;
    signedIn: boolean;
    email: string | null;
    sites: string[];
    clientIdSet: boolean;
    ga4PropertyId: string | null;
  };
};

const inputCls =
  "w-full rounded-lg border border-edge bg-panel-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none";
const btnCls =
  "rounded-lg border border-edge bg-panel-2 px-4 py-2 text-sm font-medium text-foreground hover:border-accent disabled:opacity-50";

function Pill({ on, label }: { on: boolean; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        on ? "border-emerald-300 bg-emerald-50 text-emerald-600" : "border-edge bg-panel-2 text-muted"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-muted"}`} />
      {label ?? (on ? "Connected" : "Not connected")}
    </span>
  );
}

const GOOGLE_ERRORS: Record<string, string> = {
  setup: "Finish the one-time setup below first, then try signing in again.",
  state_mismatch: "The sign-in got interrupted. Please try again.",
  no_code: "Google didn't send us back a sign-in code. Please try again.",
  no_refresh_token: "Google signed you in but didn't give lasting access. Try again — it should ask for permission this time.",
  exchange_failed:
    "Google rejected the final step. Usually the Client ID/secret is mistyped, or the redirect link wasn't added to your Google setup.",
  access_denied: "You pressed Cancel on Google's permission screen. Try again and press Allow.",
};

export function ConnectionCards({
  destId,
  result = null,
  googleAuthBack,
  onChange,
}: {
  /** Board these connections belong to. Omitted only right after onboarding's OAuth round-trip — the server then falls back to the newest board. */
  destId?: string;
  result?: "ok" | string | null;
  googleAuthBack?: string;
  onChange?: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const refresh = useCallback(() => {
    fetch(destId ? `/api/connections?dest=${encodeURIComponent(destId)}` : "/api/connections")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
    onChange?.();
  }, [destId, onChange]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-5">
      <BingCard status={status} destId={destId} onSaved={refresh} />
      <SearchConsoleCard status={status} destId={destId} onSaved={refresh} result={result} authBack={googleAuthBack} />
      <AnalyticsCard status={status} destId={destId} onSaved={refresh} />
    </div>
  );
}

/** Shared POST /api/connections helper for the cards. */
function useConnectionsPost(onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || "Couldn't save.");
      onSaved();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { post, busy, error };
}

function BingCard({ status, destId, onSaved }: { status: Status | null; destId?: string; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sites, setSites] = useState<string[] | null>(null);
  const connected = status?.bing.connected ?? false;

  const post = async (bingApiKey: string) => {
    setBusy(true);
    setError(null);
    setSites(null);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bingApiKey, destId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || "Couldn't save the key.");
      setKey("");
      setSites(d.bingSites ?? null);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-edge bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Bing Webmaster Tools</h3>
        <Pill on={connected} label={connected ? `Connected ${status?.bing.maskedKey ?? ""}` : undefined} />
      </div>
      <p className="mt-1 text-sm text-muted">
        Free data straight from Bing: real clicks, positions and <span className="text-foreground/90">backlinks</span>.
        Bing also powers ChatGPT search and Copilot, so it matters for AI visibility.
      </p>
      {connected ? (
        <div className="mt-3">
          <button
            onClick={() => post("")}
            disabled={busy}
            className={`${btnCls} text-rose-600 hover:border-rose-400`}
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
          <p className="mt-1 text-xs text-muted">To use a different key, disconnect first.</p>
        </div>
      ) : (
        <>
          <p className="mt-2 text-xs text-muted">
            Where to find it: Bing Webmaster Tools → gear icon (Settings) →{" "}
            <span className="text-foreground/80">API access</span> → API key.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste your Bing API key"
              className={`${inputCls} min-w-[220px] flex-1`}
              type="password"
              autoComplete="off"
            />
            <button onClick={() => post(key.trim())} disabled={busy || !key.trim()} className={btnCls}>
              {busy ? "Checking with Bing…" : "Save & verify"}
            </button>
          </div>
        </>
      )}
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      {sites && (
        <p className="mt-2 text-sm text-emerald-600">
          ✓ Key works.{" "}
          {sites.length
            ? `Bing sees ${sites.length} site${sites.length > 1 ? "s" : ""} on this account: ${sites.join(", ")}`
            : "No sites on this Bing account yet — add your site in Bing Webmaster Tools."}
        </p>
      )}
    </section>
  );
}

function SearchConsoleCard({
  status,
  destId,
  onSaved,
  result,
  authBack,
}: {
  status: Status | null;
  destId?: string;
  onSaved: () => void;
  result: "ok" | string | null;
  authBack?: string;
}) {
  const g = status?.google;
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const { post, busy, error } = useConnectionsPost(onSaved);

  useEffect(() => {
    setRedirectUri(`${window.location.origin}/api/google/callback`);
  }, []);

  const saveSetup = async () => {
    if (await post({ googleClientId: clientId, googleClientSecret: clientSecret })) {
      setClientId("");
      setClientSecret("");
    }
  };

  return (
    <section className="rounded-xl border border-edge bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Google Search Console</h3>
        <Pill on={!!g?.signedIn} label={g?.signedIn ? `Connected as ${g.email ?? "…"}` : undefined} />
      </div>
      <p className="mt-1 text-sm text-muted">
        Real impressions &amp; clicks from Google search — feeds the &ldquo;Reality check&rdquo; on your Overview and
        the Search Console tab.
      </p>

      {result === "ok" && (
        <p className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-600">
          ✓ Google connected successfully.
        </p>
      )}
      {result && result !== "ok" && (
        <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
          Sign-in didn&rsquo;t finish: {GOOGLE_ERRORS[result] ?? result}
        </p>
      )}

      {g?.signedIn ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-foreground/90">
            {g.sites.length ? (
              <>
                <span className="text-emerald-600">✓</span> Search Console: {g.sites.join(", ")}
              </>
            ) : (
              "Signed in, but this account can't see any Search Console sites — sign in with the account you use for Search Console."
            )}
          </p>
          <div>
            <button
              onClick={() => post({ googleDisconnect: true, destId })}
              disabled={busy}
              className={`${btnCls} text-rose-600 hover:border-rose-400`}
            >
              Disconnect
            </button>
            <p className="mt-1 text-xs text-muted">
              Google Analytics below uses this same sign-in, so disconnecting turns that off too.
            </p>
          </div>
        </div>
      ) : g?.clientIdSet ? (
        <div className="mt-3">
          <a
            href={`/api/google/auth?${new URLSearchParams({
              ...(authBack ? { back: authBack } : {}),
              ...(destId ? { dest: destId } : {}),
            })}`}
            className="inline-flex items-center gap-2 rounded-lg border border-edge bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-100"
          >
            <span className="text-base leading-none">G</span> Sign in with Google
          </a>
          <p className="mt-2 text-xs text-muted">
            Use the Google account that has access to your Search Console. Google will ask permission to{" "}
            <span className="text-foreground/80">read</span> your data — nothing else.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-amber-700">
          One-time setup needed below (~5 minutes), then it&rsquo;s a single &ldquo;Sign in with Google&rdquo; click
          forever.
        </p>
      )}

      {!g?.signedIn && (
        <details className="mt-3 rounded-lg border border-edge bg-panel-2 px-3 py-2" open={!g?.clientIdSet}>
          <summary className="cursor-pointer text-xs font-medium text-foreground/80">
            {g?.clientIdSet ? "Change the one-time setup" : "One-time setup (~5 minutes, exact clicks)"}
          </summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-muted">
            <li>
              Open <span className="text-foreground/80">console.cloud.google.com</span> with your work Google account
              and create a project (any name, e.g. &ldquo;SEOGEO&rdquo;).
            </li>
            <li>
              Search for <span className="text-foreground/80">&ldquo;Search Console API&rdquo;</span> → Enable. Then{" "}
              <span className="text-foreground/80">&ldquo;Google Analytics Data API&rdquo;</span> → Enable.
            </li>
            <li>
              Search for <span className="text-foreground/80">&ldquo;OAuth consent screen&rdquo;</span> → choose{" "}
              <span className="text-foreground/80">Internal</span> → app name &ldquo;SEOGEO&rdquo; → your email → Save.
              (If Internal isn&rsquo;t offered, pick External and add yourself as a test user.)
            </li>
            <li>
              Go to <span className="text-foreground/80">Credentials</span> → Create credentials →{" "}
              <span className="text-foreground/80">OAuth client ID</span> → type{" "}
              <span className="text-foreground/80">Web application</span>.
            </li>
            <li>
              Under <span className="text-foreground/80">Authorized redirect URIs</span> press Add URI and paste:
              <span className="mt-1 block select-all break-all rounded bg-panel px-2 py-1 font-mono text-foreground/90">
                {redirectUri || "…"}
              </span>
            </li>
            <li>Press Create — Google shows a Client ID and a Client secret. Paste both below.</li>
          </ol>
          <div className="mt-3 space-y-2">
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Client ID (ends in .apps.googleusercontent.com)"
              className={inputCls}
              autoComplete="off"
            />
            <input
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Client secret"
              className={inputCls}
              type="password"
              autoComplete="off"
            />
            <button onClick={saveSetup} disabled={busy || !clientId.trim() || !clientSecret.trim()} className={btnCls}>
              {busy ? "Saving…" : "Save setup"}
            </button>
          </div>
        </details>
      )}

      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </section>
  );
}

function AnalyticsCard({ status, destId, onSaved }: { status: Status | null; destId?: string; onSaved: () => void }) {
  const g = status?.google;
  const [propertyId, setPropertyId] = useState("");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const { post, busy, error } = useConnectionsPost(onSaved);

  const saveGa4 = async () => {
    if (await post({ ga4PropertyId: propertyId.trim(), destId })) {
      setEditing(false);
      setSaved(true);
    }
  };

  return (
    <section className="rounded-xl border border-edge bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Google Analytics</h3>
        <Pill on={!!g?.signedIn && !!g?.ga4PropertyId} />
      </div>
      <p className="mt-1 text-sm text-muted">
        Real visits and <span className="text-foreground/90">visits from AI</span> on your site — powers the Real
        Visits + Visits from AI cards for this board.
      </p>

      {!g?.signedIn ? (
        <p className="mt-3 text-sm text-muted">
          First sign in with Google in the <span className="text-foreground/80">Search Console</span> card above —
          Analytics uses the same sign-in. Then enter your GA4 property ID here.
        </p>
      ) : g.ga4PropertyId && !editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-foreground/90">
          <span>
            <span className="text-emerald-600">✓</span> Analytics: property {g.ga4PropertyId}
            {saved && <span className="text-emerald-600"> — saved &amp; verified</span>}
          </span>
          <button
            onClick={() => {
              setPropertyId(g.ga4PropertyId ?? "");
              setSaved(false);
              setEditing(true);
            }}
            className="rounded-lg border border-edge bg-panel-2 px-2.5 py-1 text-xs font-medium text-foreground hover:border-accent"
          >
            Change
          </button>
          <button
            onClick={() => post({ ga4PropertyId: "", destId })}
            disabled={busy}
            className="rounded-lg border border-edge bg-panel-2 px-2.5 py-1 text-xs font-medium text-rose-600 hover:border-rose-400 disabled:opacity-50"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              placeholder="GA4 property ID — e.g. 345860521"
              className={`${inputCls} min-w-[220px] flex-1`}
            />
            <button onClick={saveGa4} disabled={busy || !propertyId.trim()} className={btnCls}>
              {busy ? "Checking with Google…" : "Save & verify"}
            </button>
            {editing && (
              <button onClick={() => setEditing(false)} disabled={busy} className={btnCls}>
                Cancel
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">
            Each board has its own property. Copy the number from Google Analytics → Admin → Property details.
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </section>
  );
}
