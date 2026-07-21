import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "spend.json");
const RECENT_CAP = 200;

export type SpendEntry = { ts: string; path: string; costUsd: number };
export type SpendLog = {
  totalUsd: number;
  totalCalls: number;
  byDay: Record<string, number>;
  recent: SpendEntry[];
};

const empty = (): SpendLog => ({ totalUsd: 0, totalCalls: 0, byDay: {}, recent: [] });

async function read(): Promise<SpendLog> {
  try {
    return { ...empty(), ...(JSON.parse(await fs.readFile(FILE, "utf8")) as SpendLog) };
  } catch {
    return empty();
  }
}

// A report fires ~50 calls at once; each recordSpend does read-modify-write on the same
// file. Without serialization they read the same starting state and clobber each other, so
// most costs are lost (the bug behind the wildly-low spend total). This promise chain forces
// the read-modify-write steps to run one at a time, in order.
let writeChain: Promise<void> = Promise.resolve();

/** Add one DataForSEO call's cost to the running log. Never throws — logging must not break a real request. */
export async function recordSpend(apiPath: string, costUsd: unknown): Promise<void> {
  const cost = typeof costUsd === "number" && isFinite(costUsd) ? costUsd : 0;
  if (cost <= 0) return;
  writeChain = writeChain.then(async () => {
    try {
      const log = await read();
      const day = new Date().toISOString().slice(0, 10);
      log.totalUsd += cost;
      log.totalCalls += 1;
      log.byDay[day] = (log.byDay[day] ?? 0) + cost;
      log.recent.unshift({ ts: new Date().toISOString(), path: apiPath, costUsd: cost });
      log.recent = log.recent.slice(0, RECENT_CAP);
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(FILE, JSON.stringify(log, null, 2), "utf8");
    } catch {
      // swallow — never let spend logging break a data fetch
    }
  });
  return writeChain;
}

export async function getSpendLog(): Promise<SpendLog> {
  return read();
}
