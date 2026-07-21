import Anthropic from "@anthropic-ai/sdk";
import { discoverQuestions } from "./dataforseo";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SITE_MODEL = "claude-sonnet-4-6";
const ALIAS_MODEL = "claude-haiku-4-5-20251001";

export type SiteAnalysis = {
  companyName: string;
  summary: string;
  country: string;
  language: string;
  competitors: { name: string; url: string }[];
  questions: { text: string; type: "Commercial" | "Informational"; source?: "search" | "ai" }[];
  keywords: string[];
  angles: string[];
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchHtml(url: string, timeout = 12000): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (SEOGEO-Solver)" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`site returned ${res.status}`);
  return res.text();
}

export async function fetchSiteText(url: string): Promise<string> {
  const html = await fetchHtml(url);
  return stripHtml(html).slice(0, 8000);
}

const SKIP_PATH = /\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|css|js|ico|woff2?)(\?|$)/i;
const LOW_VALUE = /(privacy|terms|cookie|legal|login|signin|sign-in|cart|careers?|jobs)/i;

/** Pick a few distinct internal pages (services/solutions/etc.) so the AI sees every angle. */
function pickInternalLinks(homepageHtml: string, base: string, max = 5): string[] {
  const baseUrl = new URL(base);
  const seen = new Set<string>([baseUrl.pathname.replace(/\/$/, "") || "/"]);
  const picked: string[] = [];
  const hrefs = [...homepageHtml.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  for (const href of hrefs) {
    if (picked.length >= max) break;
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:"))
      continue;
    let u: URL;
    try {
      u = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (u.hostname !== baseUrl.hostname) continue;
    if (SKIP_PATH.test(u.pathname) || LOW_VALUE.test(u.pathname)) continue;
    const key = u.pathname.replace(/\/$/, "") || "/";
    if (seen.has(key)) continue;
    seen.add(key);
    u.hash = "";
    picked.push(u.toString());
  }
  return picked;
}

/** Read the homepage plus a handful of inner pages, concatenated and labelled per page. */
export async function fetchSitePages(url: string): Promise<string> {
  const homeHtml = await fetchHtml(url);
  const homeText = stripHtml(homeHtml);
  const links = pickInternalLinks(homeHtml, url);

  const innerTexts = await Promise.all(
    links.map(async (link) => {
      try {
        const text = stripHtml(await fetchHtml(link, 8000));
        if (text.length < 120) return null;
        return `PAGE: ${link}\n${text.slice(0, 3500)}`;
      } catch {
        return null;
      }
    })
  );

  const parts = [`PAGE: ${url} (homepage)\n${homeText.slice(0, 6000)}`];
  for (const t of innerTexts) if (t) parts.push(t);
  return parts.join("\n\n---\n\n").slice(0, 18000);
}

export async function readSite(url: string): Promise<SiteAnalysis> {
  const siteText = await fetchSitePages(url);

  const tool: Anthropic.Tool = {
    name: "report",
    description: "Report the structured analysis of the company website.",
    input_schema: {
      type: "object",
      properties: {
        companyName: {
          type: "string",
          description:
            "The company's own brand name as it presents itself on the site (e.g. 'CertiK', 'Hexens'). Not a tagline or legal suffix.",
        },
        summary: {
          type: "string",
          description: "2-3 sentence plain-language summary of what the company does.",
        },
        country: {
          type: "string",
          description: "The company's main market as a country name, or 'Worldwide'.",
        },
        language: { type: "string", description: "Primary language of the site, e.g. 'English'." },
        competitors: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, url: { type: "string" } },
            required: ["name", "url"],
          },
          description: "4-6 likely competitor companies with their website URLs.",
        },
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              type: { type: "string", enum: ["Commercial", "Informational"] },
            },
            required: ["text", "type"],
          },
          description:
            "10-15 natural-language questions a potential customer would ask an AI chatbot (ChatGPT, Gemini), that this company would want to be mentioned in. Mix buying-intent and research questions. Tag each Commercial or Informational.",
        },
        keywords: {
          type: "array",
          items: { type: "string" },
          description:
            "10-15 short Google search phrases (2-4 words) the way real users type into Google, e.g. 'web3 security audit', 'smart contract auditors'. Short keywords, NOT full questions. Mix of category terms and buying-intent terms relevant to this company.",
        },
        angles: {
          type: "array",
          items: { type: "string" },
          description:
            "4-6 short seed phrases (2-3 words each) naming the DISTINCT service lines / topics / angles this company actually covers, judged from the different pages provided — e.g. 'smart contract audit', 'zk circuit audit', 'defi security', 'bridge audit', 'blockchain red team'. These must be genuinely different angles (not reworded duplicates) and grounded in the pages, since each becomes a seed for finding top Google searches in that area.",
        },
      },
      required: [
        "companyName",
        "summary",
        "country",
        "language",
        "competitors",
        "questions",
        "keywords",
        "angles",
      ],
    },
  };

  const msg = await anthropic.messages.create({
    model: SITE_MODEL,
    max_tokens: 1500,
    tools: [tool],
    tool_choice: { type: "tool", name: "report" },
    messages: [
      {
        role: "user",
        content: `Analyze this company and call the report tool. Below are several pages from its website (homepage plus inner pages), separated by '---'. Use the variety of pages to identify the distinct angles/service lines the company covers.\n\nURL: ${url}\n\nWEBSITE PAGES:\n${siteText}`,
      },
    ],
  });

  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("no analysis returned");
  const analysis = block.input as SiteAnalysis;

  analysis.questions = await groundQuestions(analysis.questions, analysis.keywords);
  return analysis;
}

const COMMERCIAL =
  /\b(best|top|cheap|cheapest|affordable|cost|costs|price|pricing|hire|buy|vendor|vendors|provider|providers|company|companies|service|services|firm|firms|agency|review|reviews|vs|near me|quote)\b/i;

function classifyQuestion(q: string): "Commercial" | "Informational" {
  return COMMERCIAL.test(q) ? "Commercial" : "Informational";
}

/**
 * Replace the model's guessed questions with real ones people search for (Google's
 * "People also ask" + autocomplete), seeded from the company's keywords. The AI list is
 * kept only as a top-up if real questions come back short, and as a full fallback if the
 * search lookup fails — so the form is never left empty.
 */
async function groundQuestions(
  aiQuestions: SiteAnalysis["questions"],
  seeds: string[]
): Promise<SiteAnalysis["questions"]> {
  try {
    const real = await discoverQuestions(seeds, 15);
    if (!real.length) return aiQuestions;

    const merged: SiteAnalysis["questions"] = real.map((text) => ({
      text,
      type: classifyQuestion(text),
      source: "search",
    }));

    if (merged.length < 10) {
      const seen = new Set(merged.map((q) => q.text.toLowerCase().replace(/\s+/g, " ")));
      for (const q of aiQuestions) {
        const norm = q.text.toLowerCase().replace(/\s+/g, " ");
        if (seen.has(norm)) continue;
        seen.add(norm);
        merged.push({ ...q, source: "ai" });
        if (merged.length >= 12) break;
      }
    }
    return merged;
  } catch {
    return aiQuestions;
  }
}

export type Recommendation = {
  title: string; // the action, plain and short
  why: string; // one grounded line on why it helps
};

const REC_MODEL = "claude-sonnet-4-6";

/**
 * Turn a finished report into a short, prioritized to-do list a non-technical owner can act on.
 * Grounded strictly in the numbers we pass — the prompt forbids inventing figures or overpromising,
 * and the list is hard-capped so it never overwhelms. Anthropic-only (no DataForSEO spend).
 */
export async function recommendActions(input: {
  companyName: string;
  shareOfVoicePct: number | null; // 0..100, how often AI answers name the company
  avgGoogleRank: number | null;
  rankedCount: number;
  totalQueries: number;
  aiOverviewPresent: number; // phrases where Google shows an AI Overview
  aiOverviewCited: number; // of those, how many cite the company
  missingBuyerQuestions: string[]; // buying-intent questions where AI answered but didn't name them
  keywordGaps: { keyword: string; searchVolume: number | null; competitor: string }[];
  companyVisits: number | null; // estimated monthly Google visits
  topCompetitor: { name: string; visits: number | null } | null;
}): Promise<Recommendation[]> {
  const tool: Anthropic.Tool = {
    name: "recommendations",
    description: "Report a short, prioritized list of concrete next actions.",
    input_schema: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description:
                  "One concrete action, ~6-10 words, starts with a verb, plain language a non-technical business owner understands. No jargon, no acronyms.",
              },
              why: {
                type: "string",
                description:
                  "One short sentence on why it helps, grounded ONLY in the numbers provided. State it plainly — never promise or guarantee a result (no 'will double', 'guaranteed', 'skyrocket').",
              },
            },
            required: ["title", "why"],
          },
          description:
            "3 to 5 actions, most impactful first. Fewer is better than padded. Every item must be specific and doable — no vague advice like 'improve your content'.",
        },
      },
      required: ["actions"],
    },
  };

  const gapLines = input.keywordGaps.length
    ? input.keywordGaps
        .map(
          (g) =>
            `- "${g.keyword}"${g.searchVolume != null ? ` (~${g.searchVolume} searches/mo)` : ""}, ${input.companyName} doesn't rank, ${g.competitor} does`
        )
        .join("\n")
    : "- none found";
  const missLines = input.missingBuyerQuestions.length
    ? input.missingBuyerQuestions.map((q) => `- "${q}"`).join("\n")
    : "- none";

  const data = [
    `Company: ${input.companyName}`,
    `AI Share of Voice: ${input.shareOfVoicePct != null ? `${input.shareOfVoicePct}%` : "unknown"} (how often ChatGPT/Gemini name them vs competitors)`,
    `Average Google rank: ${input.avgGoogleRank != null ? input.avgGoogleRank.toFixed(1) : "unranked"} across ${input.rankedCount} of ${input.totalQueries} tracked phrases`,
    `Google AI Overview: appears for ${input.aiOverviewPresent} phrases, cites ${input.companyName} in ${input.aiOverviewCited}`,
    `Estimated monthly Google visits: ${input.companyVisits != null ? input.companyVisits : "unknown"}${
      input.topCompetitor
        ? `; top competitor ${input.topCompetitor.name}: ${input.topCompetitor.visits != null ? input.topCompetitor.visits : "unknown"}`
        : ""
    }`,
    ``,
    `Buying-intent questions where AI answered but did NOT name ${input.companyName}:`,
    missLines,
    ``,
    `Top phrases competitors rank for that ${input.companyName} is missing:`,
    gapLines,
  ].join("\n");

  const msg = await anthropic.messages.create({
    model: REC_MODEL,
    max_tokens: 700,
    tools: [tool],
    tool_choice: { type: "tool", name: "recommendations" },
    messages: [
      {
        role: "user",
        content: `You advise ${input.companyName} on getting found in AI answers (ChatGPT, Gemini) and Google. Below is this week's report. Call the recommendations tool with the few highest-impact, concrete next moves.\n\nRules: tie each action to the data below; never invent numbers; never overpromise; keep it to the genuinely useful few, ordered by impact. If the data is thin, return fewer actions rather than padding.\n\nREPORT:\n${data}`,
      },
    ],
  });

  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return [];
  const actions = (block.input as { actions?: Recommendation[] }).actions ?? [];
  return actions.slice(0, 5);
}

export async function suggestAliases(companyName: string, url?: string): Promise<string[]> {
  const tool: Anthropic.Tool = {
    name: "aliases",
    description: "Report alternative names/spellings the company is known by.",
    input_schema: {
      type: "object",
      properties: {
        aliases: {
          type: "array",
          items: { type: "string" },
          description:
            "3-6 alternative spellings/names this company is searched by (legal name, domain, common short forms). Exclude the exact input name.",
        },
      },
      required: ["aliases"],
    },
  };

  const msg = await anthropic.messages.create({
    model: ALIAS_MODEL,
    max_tokens: 300,
    tools: [tool],
    tool_choice: { type: "tool", name: "aliases" },
    messages: [
      {
        role: "user",
        content: `Company name: "${companyName}"${url ? `\nWebsite: ${url}` : ""}\nSuggest alternative names/spellings it is searched by.`,
      },
    ],
  });

  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return [];
  return (block.input as { aliases: string[] }).aliases ?? [];
}
