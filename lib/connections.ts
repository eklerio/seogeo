import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "connections.json");

/** One Google sign-in (tokens + account) — stored per board. */
export type GoogleAuth = {
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiry?: string;
  email?: string;
  sites?: string[];
};

/** The one-time OAuth app setup (Google Cloud client) — shared by all boards. */
export type GoogleClient = {
  clientId?: string;
  clientSecret?: string;
};

/** Everything a single board has plugged in. Boards never share these. */
export type BoardConnections = {
  bingApiKey?: string;
  google?: GoogleAuth;
  ga4PropertyId?: string;
};

export type Connections = {
  googleClient?: GoogleClient;
  boards?: Record<string, BoardConnections>;
  updatedAt?: string;
};

// Same serialized-write pattern as store.ts / spend.ts.
let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const p = writeChain.then(fn, fn);
  writeChain = p.catch(() => {});
  return p;
}

export async function getConnections(): Promise<Connections> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Connections;
  } catch {
    return {};
  }
}

export async function boardConnections(destId: string): Promise<BoardConnections> {
  return (await getConnections()).boards?.[destId] ?? {};
}

async function persist(next: Connections) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(next, null, 2), "utf8");
}

function withBoard(
  cur: Connections,
  destId: string,
  patch: (board: BoardConnections) => BoardConnections | undefined
): Connections {
  const boards = { ...cur.boards };
  const next = patch(boards[destId] ?? {});
  if (next === undefined) delete boards[destId];
  else boards[destId] = next;
  return { ...cur, boards, updatedAt: new Date().toISOString() };
}

export async function saveGoogleClient(clientId: string, clientSecret: string): Promise<void> {
  return serialize(async () => {
    const cur = await getConnections();
    await persist({ ...cur, googleClient: { clientId, clientSecret }, updatedAt: new Date().toISOString() });
  });
}

/** Set (or clear, with "") one board's Bing API key. */
export async function saveBoardBing(destId: string, key: string): Promise<void> {
  return serialize(async () => {
    const cur = await getConnections();
    await persist(
      withBoard(cur, destId, (b) => {
        const next = { ...b };
        if (key === "") delete next.bingApiKey;
        else next.bingApiKey = key;
        return next;
      })
    );
  });
}

/** Merge a partial update into one board's Google sign-in; null forgets the sign-in entirely. */
export async function saveBoardGoogleAuth(destId: string, patch: Partial<GoogleAuth> | null): Promise<void> {
  return serialize(async () => {
    const cur = await getConnections();
    await persist(
      withBoard(cur, destId, (b) => {
        const next = { ...b };
        if (patch === null) {
          delete next.google;
          return next;
        }
        const google: GoogleAuth = { ...next.google, ...patch };
        (Object.keys(google) as (keyof GoogleAuth)[]).forEach((k) => {
          if (google[k] === "") delete google[k];
        });
        next.google = google;
        return next;
      })
    );
  });
}

/** Set (or clear, with "") one board's GA4 property. */
export async function saveGa4Property(destId: string, propertyId: string): Promise<void> {
  return serialize(async () => {
    const cur = await getConnections();
    await persist(
      withBoard(cur, destId, (b) => {
        const next = { ...b };
        if (propertyId === "") delete next.ga4PropertyId;
        else next.ga4PropertyId = propertyId;
        return next;
      })
    );
  });
}

const mask = (key: string) => (key.length > 4 ? `••••${key.slice(-4)}` : "••••");

/** Safe-to-send-to-the-browser view of ONE board: connected flags + masked hints, never secrets. */
export async function connectionStatus(destId?: string) {
  const c = await getConnections();
  const b = (destId && c.boards?.[destId]) || {};
  const signedIn = !!b.google?.refreshToken;
  return {
    bing: { connected: !!b.bingApiKey, maskedKey: b.bingApiKey ? mask(b.bingApiKey) : null },
    google: {
      connected: signedIn,
      signedIn,
      email: b.google?.email ?? null,
      sites: b.google?.sites ?? [],
      clientIdSet: !!(c.googleClient?.clientId && c.googleClient?.clientSecret),
      ga4PropertyId: b.ga4PropertyId ?? null,
    },
    updatedAt: c.updatedAt ?? null,
  };
}
