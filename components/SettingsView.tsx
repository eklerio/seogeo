"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Destination } from "@/lib/store";
import DestinationForm from "./DestinationForm";
import { ConnectionCards } from "./Connections";
import { TABS, TabIcon, favicon } from "./Workspace";
import { ALL_ENGINES, ENGINE_LABEL, ENGINE_UNIT_COST, destEngines, type EngineId } from "@/lib/engines";

export type SettingsSection = "site" | "ai" | "connections" | "danger";

const SECTION_NAV: { key: SettingsSection; label: string; danger?: boolean }[] = [
  { key: "site", label: "Site settings" },
  { key: "ai", label: "AI chatbots" },
  { key: "connections", label: "Connections" },
  { key: "danger", label: "Terminate board", danger: true },
];

export default function SettingsView({
  destination,
  destinations,
  initialSection,
}: {
  destination: Destination;
  destinations: Destination[];
  initialSection: SettingsSection;
}) {
  const router = useRouter();
  const [section, setSection] = useState<SettingsSection>(initialSection);

  // Keep the URL in sync so a refresh / share lands on the same section (no server re-render).
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("board", destination.id);
    u.searchParams.set("section", section);
    window.history.replaceState({}, "", u);
  }, [section, destination.id]);

  const backToBoard = `/workspace?board=${destination.id}`;

  return (
    <div className="flex min-h-screen">
      {/* Fold 1 — icon rail */}
      <nav className="sticky top-0 flex h-screen w-16 shrink-0 flex-col items-center gap-1 border-r border-edge bg-panel/60 py-4">
        <button
          onClick={() => router.push(backToBoard)}
          title="Back to board"
          className="mb-2 flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-black text-sm font-bold text-white"
        >
          <img
            src={favicon(destination.url)}
            alt={destination.companyName}
            className="h-6 w-6 rounded"
            onError={(e) => {
              const img = e.currentTarget;
              img.style.display = "none";
              img.parentElement?.append(
                Object.assign(document.createElement("span"), {
                  textContent: (destination.companyName || "?").charAt(0).toUpperCase(),
                }),
              );
            }}
          />
        </button>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => router.push(`/workspace?board=${destination.id}&tab=${encodeURIComponent(t)}`)}
            title={t}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-black/[0.04] hover:text-foreground"
          >
            <TabIcon tab={t} />
          </button>
        ))}
        <button
          onClick={() => router.push("/?new=1")}
          title="Add board"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-black/[0.04] hover:text-foreground"
        >
          <span className="text-lg leading-none">＋</span>
        </button>
        <div className="mt-auto flex h-9 w-9 items-center justify-center rounded-lg bg-[#dbeaff] text-accent" title="Settings">
          <GearGlyph />
        </div>
      </nav>

      {/* Fold 2 — settings sub-sidebar */}
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col gap-4 border-r border-edge bg-panel/40 px-4 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        </div>
        <p className="-mt-2 truncate text-xs text-muted" title={destination.companyName}>
          {destination.companyName}
        </p>
        <nav className="flex flex-col gap-1">
          {SECTION_NAV.map((n) => {
            const active = section === n.key;
            return (
              <button
                key={n.key}
                onClick={() => setSection(n.key)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                  active
                    ? n.danger
                      ? "bg-rose-50 text-rose-600"
                      : "bg-[#dbeaff] text-foreground"
                    : n.danger
                      ? "text-rose-600 hover:bg-rose-50"
                      : "text-muted hover:bg-panel hover:text-foreground"
                }`}
              >
                {n.label}
              </button>
            );
          })}
        </nav>
        <button
          onClick={() => router.push(backToBoard)}
          className="mt-auto text-left text-sm text-muted hover:text-foreground"
        >
          &larr; Back to board
        </button>
      </aside>

      {/* Content */}
      <main className="min-w-0 flex-1 overflow-y-auto px-8 py-10">
        <div className="mx-auto max-w-3xl">
          {section === "site" && (
            <>
              <h2 className="text-2xl font-bold text-foreground">Site settings</h2>
              <p className="mt-1 text-sm text-muted">
                Update this company&rsquo;s details, or point the tool at a different one.
              </p>
              <div className="mt-6">
                <DestinationForm
                  initial={destination}
                  submitLabel="Save changes"
                  onDone={() => router.refresh()}
                />
              </div>
            </>
          )}

          {section === "ai" && <EngineSection destination={destination} />}

          {section === "connections" && (
            <>
              <h2 className="text-2xl font-bold text-foreground">Connections</h2>
              <p className="mt-1 text-sm text-muted">
                Plug in real data sources. Keys are stored on your server only — never shown again in
                full.
              </p>
              <div className="mt-6">
                <ConnectionCards destId={destination.id} />
              </div>
            </>
          )}

          {section === "danger" && (
            <TerminateSection destination={destination} destinations={destinations} />
          )}
        </div>
      </main>
    </div>
  );
}

function EngineSection({ destination }: { destination: Destination }) {
  const [selected, setSelected] = useState<EngineId[]>(destEngines(destination.engines));
  const [saved, setSaved] = useState<EngineId[]>(destEngines(destination.engines));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState(false);

  // Auto-dismiss the "run a new report" toast after a few seconds.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(false), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const nQuestions = destination.questions.length;
  const changed =
    selected.length !== saved.length || selected.some((e) => !saved.includes(e));

  const weeklyFor = (e: EngineId) => nQuestions * ENGINE_UNIT_COST[e];
  const weeklyTotal = selected.reduce((s, e) => s + weeklyFor(e), 0);

  const toggle = (e: EngineId) => {
    setSavedAt(null);
    setSelected((cur) =>
      cur.includes(e)
        ? cur.length > 1
          ? cur.filter((x) => x !== e)
          : cur // keep at least one chatbot selected
        : ALL_ENGINES.filter((x) => cur.includes(x) || x === e)
    );
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/destinations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...destination, engines: selected }),
      });
      if (!res.ok) throw new Error();
      setSaved(selected);
      setSavedAt(Date.now());
      setToast(true);
    } catch {
      setError("Couldn’t save — please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h2 className="text-2xl font-bold text-foreground">AI chatbots</h2>
      <p className="mt-1 text-sm text-muted">
        Pick which AIs we ask your {nQuestions} tracked questions. Each one you add makes your AI
        Share of Voice broader — and adds its own cost to the weekly report.
      </p>

      <div className="mt-6 space-y-3">
        {ALL_ENGINES.map((e) => {
          const on = selected.includes(e);
          return (
            <button
              key={e}
              type="button"
              onClick={() => toggle(e)}
              aria-pressed={on}
              className={`flex w-full items-center justify-between rounded-xl border p-4 text-left transition ${
                on ? "border-accent bg-[#dbeaff]/40" : "border-edge bg-panel-2 hover:border-accent/50"
              }`}
            >
              <span className="flex items-center gap-3">
                <span
                  aria-hidden
                  className={`flex h-5 w-5 items-center justify-center rounded border text-xs font-bold ${
                    on ? "border-accent bg-accent text-white" : "border-edge bg-white text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className="text-sm font-semibold text-foreground">{ENGINE_LABEL[e]}</span>
              </span>
              <span className="text-right text-xs text-muted">
                <span className="block font-medium text-foreground/80">
                  +${weeklyFor(e).toFixed(2)} per weekly report
                </span>
                {nQuestions} questions × ${ENGINE_UNIT_COST[e].toFixed(3)} each
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 rounded-xl border border-edge bg-panel-2 p-4 text-sm">
        <p className="text-foreground/90">
          Your selection adds{" "}
          <span className="font-semibold text-foreground">${weeklyTotal.toFixed(2)}</span> in AI
          answers to each weekly report.
        </p>
        <p className="mt-1 text-xs text-muted">
          Manual re-runs in the same week reuse the saved answers, so they add $0 for chatbots. A
          newly added chatbot is asked (and billed) on your next report run.
        </p>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={save}
          disabled={!changed || saving}
          className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition ${
            changed && !saving
              ? "bg-black text-white hover:bg-black/85"
              : "border border-edge bg-panel-2 text-muted"
          }`}
        >
          {saving ? "Saving…" : "Save selection"}
        </button>
        {savedAt && !changed && <span className="text-sm text-emerald-600">✓ Saved</span>}
        {error && <span className="text-sm text-rose-600">{error}</span>}
      </div>

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-edge bg-white p-4 shadow-lg shadow-black/10"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            ✓
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-foreground">Chatbots saved</p>
            <p className="mt-0.5 text-muted">Run a new report to see the changes on your board.</p>
          </div>
          <button
            onClick={() => setToast(false)}
            aria-label="Dismiss"
            className="ml-1 shrink-0 text-muted transition hover:text-foreground"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}

function TerminateSection({
  destination,
  destinations,
}: {
  destination: Destination;
  destinations: Destination[];
}) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const armed = confirmName.trim().toLowerCase() === "terminate" && !deleting;

  const terminate = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/destinations?id=${encodeURIComponent(destination.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      const data = await res.json();
      router.push(data.nextBoardId ? `/workspace?board=${data.nextBoardId}` : "/");
      router.refresh();
    } catch {
      setError("Couldn’t delete the board. Please try again.");
      setDeleting(false);
    }
  };

  return (
    <>
      <h2 className="text-2xl font-bold text-rose-600">Terminate board</h2>
      <p className="mt-1 text-sm text-muted">
        This permanently deletes{" "}
        <span className="font-medium text-foreground">{destination.companyName}</span>{" "}
        and all of its saved reports. This can&rsquo;t be undone.
      </p>
      <div className="mt-6 max-w-md rounded-xl border border-rose-200 bg-rose-50 p-5">
        <label className="text-sm font-medium text-foreground">
          Type <span className="font-mono text-rose-600">terminate</span> to confirm
        </label>
        <input
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder="terminate"
          className="mt-2 w-full rounded-lg border border-edge bg-panel-2 px-3 py-2 text-foreground outline-none focus:border-rose-400"
        />
        <button
          onClick={terminate}
          disabled={!armed}
          className={`mt-3 rounded-lg px-4 py-2 text-sm font-semibold transition ${
            armed ? "bg-rose-600 text-white hover:bg-rose-700" : "border border-edge bg-panel-2 text-muted"
          }`}
        >
          {deleting ? "Deleting…" : "Terminate this board"}
        </button>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        {destinations.length <= 1 && (
          <p className="mt-2 text-xs text-muted">
            This is your only board — you’ll be taken back to setup.
          </p>
        )}
      </div>
    </>
  );
}

function GearGlyph() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
