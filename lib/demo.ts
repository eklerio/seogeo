import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "demo-requests.json");

export type DemoRequest = {
  ts: string;
  name: string;
  email: string;
  company: string;
  website: string;
  note: string;
};

async function read(): Promise<DemoRequest[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8"));
    return Array.isArray(parsed) ? (parsed as DemoRequest[]) : [];
  } catch {
    return [];
  }
}

// Low volume, but two visitors could still submit at once — serialize the read-modify-write
// so one append never clobbers another (same pattern as spend.ts).
let writeChain: Promise<void> = Promise.resolve();

export async function saveDemoRequest(entry: DemoRequest): Promise<void> {
  writeChain = writeChain.then(async () => {
    const all = await read();
    all.unshift(entry);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
  });
  return writeChain;
}

export async function listDemoRequests(): Promise<DemoRequest[]> {
  return read();
}
