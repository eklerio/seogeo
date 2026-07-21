import { promises as fs } from "fs";
import path from "path";
import type { Snapshot } from "./report";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "destinations.json");
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");

export type Destination = {
  id: string;
  url: string;
  companyName: string;
  aliases: string[];
  country: string;
  language: string;
  summary: string;
  competitors: { name: string; url: string }[];
  questions: { text: string; type: "Commercial" | "Informational"; source?: "search" | "ai" }[];
  keywords: string[];
  keywordVolumes?: Record<string, number | null>; // cached monthly-search numbers, so opening the form is free
  engines?: string[]; // AI chatbots the weekly report asks; absent = the default pair (ChatGPT + Gemini)
  createdAt: string;
};

// Read-modify-write on the JSON files must run one at a time, or concurrent saves clobber
// each other (same fix as spend.ts and the LLM cache). Reads stay unserialized.
let writeChain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const p = writeChain.then(fn, fn);
  writeChain = p.catch(() => {});
  return p;
}

export async function listDestinations(): Promise<Destination[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    return JSON.parse(raw) as Destination[];
  } catch {
    return [];
  }
}

export async function addDestination(
  d: Omit<Destination, "id" | "createdAt">
): Promise<Destination> {
  return serialize(async () => {
    const all = await listDestinations();
    const dest: Destination = {
      ...d,
      id: Date.now().toString(36),
      createdAt: new Date().toISOString(),
    };
    all.push(dest);
    await persist(all);
    return dest;
  });
}

export async function getActiveDestination(): Promise<Destination | null> {
  const all = await listDestinations();
  return all.length ? all[all.length - 1] : null;
}

export async function updateDestination(
  id: string,
  patch: Partial<Omit<Destination, "id" | "createdAt">>
): Promise<Destination | null> {
  return serialize(async () => {
    const all = await listDestinations();
    const idx = all.findIndex((d) => d.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...patch };
    await persist(all);
    return all[idx];
  });
}

export async function deleteDestination(id: string): Promise<boolean> {
  return serialize(async () => {
    const all = await listDestinations();
    const next = all.filter((d) => d.id !== id);
    if (next.length === all.length) return false;
    await persist(next);
    // Drop this board's report snapshots too, so they don't linger as orphans.
    try {
      const reports = await readReports();
      const keep = reports.filter((s) => s.destId !== id);
      if (keep.length !== reports.length) {
        await fs.writeFile(REPORTS_FILE, JSON.stringify(keep, null, 2), "utf8");
      }
    } catch {
      /* report cleanup is best-effort */
    }
    return true;
  });
}

async function persist(all: Destination[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
}

async function readReports(): Promise<Snapshot[]> {
  try {
    return JSON.parse(await fs.readFile(REPORTS_FILE, "utf8")) as Snapshot[];
  } catch {
    return [];
  }
}

/** All snapshots for a destination, oldest first. */
export async function listReports(destId: string): Promise<Snapshot[]> {
  const all = await readReports();
  return all
    .filter((s) => s.destId === destId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addReport(snapshot: Snapshot): Promise<void> {
  return serialize(async () => {
    const all = await readReports();
    all.push(snapshot);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(REPORTS_FILE, JSON.stringify(all, null, 2), "utf8");
  });
}
