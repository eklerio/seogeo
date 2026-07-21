"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DestinationForm, {
  isValidUrl,
  scanSite,
  type DestinationInput,
} from "./DestinationForm";
import { ConnectionCards } from "./Connections";

type Step = "url" | "details" | "connect";

const STEP_LABELS = ["Website", "Details", "Connect (optional)"];

const SCAN_MESSAGES = [
  "Searching your website…",
  "Reading your homepage…",
  "Spotting your competitors…",
  "Finding what people ask AI…",
  "Ranking your Google search phrases…",
  "Brewing your questions…",
  "Sipping coffee…",
  "Almost there…",
];

export default function Onboarding({
  addBoard = false,
  initialStep = "url",
  googleResult = null,
}: {
  addBoard?: boolean;
  initialStep?: "url" | "connect";
  googleResult?: "ok" | string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialStep);
  const [url, setUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanFailed, setScanFailed] = useState(false);
  const [scanData, setScanData] = useState<DestinationInput | null>(null);
  // Lost on the Google OAuth round-trip — the connections API then falls back to the newest board.
  const [savedId, setSavedId] = useState<string | null>(null);

  const stepNumber = step === "url" ? 1 : step === "details" ? 2 : 3;

  async function go() {
    if (!isValidUrl(url) || scanning) return;
    setScanning(true);
    setScanFailed(false);
    try {
      const data = await scanSite(url);
      setScanData(data);
      setScanFailed(false);
    } catch {
      // Couldn't read the site — let them fill the details in manually.
      setScanData({
        url,
        companyName: "",
        aliases: [],
        country: "Worldwide (default market)",
        language: "English",
        summary: "",
        competitors: [],
        questions: [],
        keywords: [],
        keywordVolumes: {},
      });
      setScanFailed(true);
    } finally {
      setScanning(false);
      setStep("details");
      window.scrollTo({ top: 0 });
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-14">
      <div className="flex items-center gap-2 text-sm font-medium uppercase tracking-[0.2em] text-accent2">
        <span className="h-2 w-2 rounded-full bg-accent2" />
        SEOGEO Solver
      </div>

      <Steps current={stepNumber} />

      {step === "url" && (
        <>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-foreground">
            {addBoard ? "Set up a new board." : "Let’s set up your first board."}
          </h1>
          <p className="mt-2 text-muted">
            Point the tool at a company and we&rsquo;ll measure how visible it is across AI
            answers and Google.
          </p>
          {addBoard && (
            <p className="mt-2 text-sm">
              <Link href="/workspace" className="text-accent hover:underline">
                &larr; Back to your boards
              </Link>
            </p>
          )}

          {scanning ? (
            <ScanLoader />
          ) : (
            <div className="glass mt-8 rounded-2xl p-6">
              <label className="text-sm font-medium text-foreground/80">Website URL</label>
              <div className="mt-2 flex gap-2">
                <input
                  autoFocus
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      go();
                    }
                  }}
                  placeholder="hexens.io"
                  className="w-full rounded-lg border border-edge bg-panel-2 px-3 py-3 text-foreground outline-none transition focus:border-accent"
                />
                <button
                  type="button"
                  onClick={go}
                  disabled={!isValidUrl(url)}
                  className={`shrink-0 rounded-lg px-6 py-3 font-semibold transition ${
                    isValidUrl(url)
                      ? "glow bg-black text-white hover:bg-black/85"
                      : "border border-edge bg-panel-2 text-muted"
                  }`}
                >
                  Go
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">
                We&rsquo;ll read the site and fill in everything for you — you can edit it next.
              </p>
            </div>
          )}
        </>
      )}

      {step === "details" && scanData && (
        <>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-foreground">
            Check the details.
          </h1>
          <p className="mt-2 text-muted">
            {scanFailed
              ? "We couldn’t read your site automatically — fill in the details below."
              : "We filled these in from your site. Edit anything, then continue."}
          </p>

          <div className="glass mt-8 rounded-2xl p-6">
            <DestinationForm
              initial={scanData}
              hideUrl
              submitLabel="Next: connect your data →"
              onDone={(id) => {
                setSavedId(id || null);
                setStep("connect");
                window.scrollTo({ top: 0 });
              }}
            />
          </div>
        </>
      )}

      {step === "connect" && (
        <>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-foreground">
            Connect your real data.
          </h1>
          <p className="mt-2 text-muted">
            Your board is saved. Plug in Google and Bing now to see real visits, clicks and
            visits from AI on your Overview — or skip and do it anytime from the Connections
            button.
          </p>

          <div className="mt-8">
            <ConnectionCards destId={savedId ?? undefined} googleAuthBack="/?connect=1" result={googleResult} />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              onClick={() => router.push("/workspace")}
              className="glow rounded-lg bg-black px-5 py-2.5 text-sm font-semibold text-white hover:bg-black/85"
            >
              Open my board →
            </button>
            <button
              onClick={() => router.push("/workspace")}
              className="text-sm text-muted hover:text-foreground"
            >
              Skip for now
            </button>
          </div>
        </>
      )}
    </main>
  );
}

function Steps({ current }: { current: number }) {
  return (
    <div className="mt-4 flex items-center gap-1.5">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const active = n === current;
        const done = n < current;
        return (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                active
                  ? "bg-black text-white"
                  : done
                    ? "bg-accent/10 text-accent2"
                    : "border border-edge bg-panel-2 text-muted"
              }`}
            >
              {done ? "✓" : n}
            </span>
            <span className={`text-sm ${active ? "font-medium text-foreground" : "text-muted"}`}>
              {label}
            </span>
            {n < STEP_LABELS.length && <span className="mx-1 h-px w-6 bg-edge" />}
          </div>
        );
      })}
      <span className="ml-auto text-xs text-muted">Step {current} of {STEP_LABELS.length}</span>
    </div>
  );
}

function ScanLoader() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % SCAN_MESSAGES.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="glass mt-8 flex flex-col items-center gap-5 rounded-2xl p-14 text-center">
      <div className="relative h-14 w-14">
        <div className="absolute inset-0 rounded-full border-4 border-edge" />
        <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-black" />
      </div>
      <p key={i} className="animate-pulse text-lg font-medium text-foreground">
        {SCAN_MESSAGES[i]}
      </p>
      <p className="text-sm text-muted">
        Setting up your board — this usually takes 10–20 seconds. Hang tight.
      </p>
    </div>
  );
}
