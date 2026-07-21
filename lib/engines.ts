// Shared AI-chatbot registry — pure constants, safe to import from both server and client code.

export const ALL_ENGINES = ["chatgpt", "gemini", "perplexity", "claude"] as const;
export type EngineId = (typeof ALL_ENGINES)[number];

export const ENGINE_LABEL: Record<EngineId, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
  claude: "Claude",
};

// Average USD per question asked, observed from live DataForSEO spend.
export const ENGINE_UNIT_COST: Record<EngineId, number> = {
  chatgpt: 0.0117,
  gemini: 0.0374,
  perplexity: 0.0063, // sonar, observed live 2026-07-10
  claude: 0.0798, // claude-sonnet-4-6 with web search, observed live 2026-07-13
};

export const DEFAULT_ENGINES: EngineId[] = ["chatgpt", "gemini"];

/** The chatbots a board's weekly reports ask — its saved pick, or the default pair. */
export function destEngines(engines?: string[]): EngineId[] {
  const valid = (engines ?? []).filter((e): e is EngineId =>
    (ALL_ENGINES as readonly string[]).includes(e)
  );
  // Keep ALL_ENGINES order so every list/card shows chatbots in one stable order.
  const picked = ALL_ENGINES.filter((e) => valid.includes(e));
  return picked.length ? picked : DEFAULT_ENGINES;
}

export function engineLabels(engines: EngineId[]): string {
  return engines.map((e) => ENGINE_LABEL[e]).join(" & ");
}
