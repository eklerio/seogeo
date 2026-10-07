# SEOGEO — "AI Visibility" (Glinton)

**What this is + why it matters:** A personal tool that measures how visible a company is inside AI answers (ChatGPT, Gemini, Perplexity, Claude), how it ranks vs competitors on Google/Bing, and what to do about it. Elen's own project — she's a PM, not a developer, so explain everything in plain words.

## Health: 9/10
Onboarding, the weekly report engine, and all data sources are live with real data. **The one thing that moves it:** wire real Bing Webmaster clicks/impressions + free Bing backlinks into reports (Bing *positions* already come from DataForSEO SERP; DataForSEO Backlinks costs extra — skip it).

## State (reference)
| Thing | Value |
|---|---|
| Built with | Next.js + Tailwind (same as elen.am) |
| Preview start | `cd "/workspace/SEOGEO" && PORT=3000 setsid nohup npx next dev -p 3000 > /tmp/seogeo-dev.log 2>&1 < /dev/null & disown` |
| Live link tool | cloudflared → `setsid nohup /usr/local/bin/cloudflared tunnel --url http://localhost:3000 --no-autoupdate > /tmp/seogeo-tunnel.log 2>&1 < /dev/null & disown` |
| Read current link | `grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/seogeo-tunnel.log \| head -1` |
| Tabs | `Instant Check · Overview · GEO · Search · Competitors · Action Plan` (`TABS` in `Workspace.tsx`; deep-link `?tab=`) |

## Data sources
Live truth is `data/connections.json`, keyed per board — read it rather than any table here.
| Source | Notes not in `connections.json` |
|---|---|
| DataForSEO | Creds in `.env.local` (Basic auth). Needs a funded account. ~$0.002 per SERP query. |
| Anthropic | Key in `.env.local`. Powers site-read, aliases, recommendations. |
| Bing Webmaster | Per-board API key, live-verified on save via `GetUserSites`. |
| Google GSC + GA4 | One OAuth *client* shared; every board signs in separately. |

## Where things live
`components/` is the UI (Onboarding · DestinationForm · Workspace · SettingsView · Connections · InstantCheck · Landing); `lib/` is the logic (`report.ts` weekly run/snapshots/caches · `dataforseo.ts` SERP + volumes + `discoverQuestions()` · `ai.ts` Anthropic + `recommendActions()` · `engines.ts` chatbot registry · `google.ts` GSC+GA4 · `connections.ts` per-board secrets · `spend.ts` cost totals). Read the file for mechanics — only what you *can't* see in the code is written down below.

## Facts you can't read off the code
- **One board = one destination** — boards are just `data/destinations.json` entries; `?board=` selects one (fallback: newest).
- **Data files:** `reports.json` (one snapshot per run; Overview compares the latest two), `llm-cache.json` (AI answers, weekly), `bing-volume-cache.json` (weekly; legacy snapshots show "—"), `intel-cache.json`, `spend.json`.
- **Run costs:** first run of the week ~$1.18, same-week re-run ~$0.16. Re-runs are never gated — they refresh Google rankings and reuse cached AI answers; scoring stays live so name edits still count.
- **The two headline metrics:** *AI Share of Voice* = company-vs-competitor brand mentions in the board's selected chatbots' answers, averaged over tracked questions. *Avg Google Rank* = company position per keyword via SERP (depth 100).
- **Two tracked lists per board:** `questions` (conversational → Share of Voice) and `keywords` (short Google phrases → Avg Rank). Questions are grounded in real searches — `discoverQuestions()` seeds Google "People also ask" + autocomplete (~$0.03/scan); the AI list is only a top-up/fallback.
- **Reality check** (Overview) is free, live, and deliberately **never stored in snapshots**: `GET /api/realdata?id=` → GSC impressions/clicks, GA4 visits, and **Visits from AI** (the app's payoff metric).

## Gotchas — hard-won, keep these
- **Never import a runtime value from a `"use client"` module into a server component.** It becomes a client-reference proxy (`TABS.includes is not a function`, 500). Server pages import only `type Tab`/`type SettingsSection`; the valid tab/section lists are deliberately *duplicated* inline in the server pages. Client→client value imports are fine.
- **All DataForSEO calls must route through `post()` in `lib/dataforseo.ts`** — it's the single spend chokepoint. A call made around it bills invisibly.
- **Serialize writes to `llm-cache.json`** (`llmCacheChain`, same pattern as `spend.ts`). Concurrent per-engine writes clobbered each other and silently re-billed one engine every run.
- **`Destination.engines?` absent = the default ChatGPT+Gemini pair**, so old boards need no migration. `PUT /api/destinations` only touches `engines` when the body actually sends an array — keep that guard or an older caller wipes a board's pick.
- **`recommendActions` is hard-capped at 5**; its prompt forbids invented numbers and overpromising, and a writer failure is caught so it never sinks the report.
- **Onboarding's OAuth return path** (`?back=`) is cookie-stored and must start with `/`.
- **Never conflate the two "AI" things.** "AI answers" = the chatbots (GEO tab). "Google AI Overview" = the summary Google writes atop its own results. Elen got badly confused when both used the word "AI answers" — the Google card must stay labelled *Google AI Overview*.
- **Share-of-voice % renders with one decimal (`.toFixed(1)`) everywhere.** A rounded 11% next to a precise 10.7% for the same metric confused Elen.
- **`InfoTip` tooltips must open above the icon.** Opening below lets the next `.glass` card's backdrop-filter stacking context paint over and clip them.
- **Sortable tables:** blank/null values always sink to the bottom regardless of sort direction; the first/title column is never sortable; row actions key off **identity, not array index** (`removeQuestion(text)`, never `(idx)`) because rows reorder.
- **Google is OAuth, never service-account keys.** Elen's org enforces `iam.disableServiceAccountKeyCreation`, and the JSON-paste flow confused her badly. The redirect URI is computed from `window.location.origin`, so **it must be re-entered in Google whenever the tunnel URL changes.**
- **All connection data is per board, never global.** Storing a key or property site-wide once leaked one board's GA4 into another.
- **GSC lags 2–3 days** — its windows end 3 days back; GA4 ends yesterday. Don't "fix" the offset.
- **No metric lives in two places** (the no-duplicate-preview rule) — a duplicated "AI Visibility %" box was removed for this reason.
- **Restyle via tokens first, hardcoded classes second.** Theme is the light "Dub" style (white canvas, 1px hairline borders, Inter, one electric-blue accent, black primary buttons); tokens live in `globals.css` (`.glass`, `.glow`).
- Keys live in `.env.local`, **never `git add`**. See `.env.example`.

## Elen's product decisions — don't re-litigate
- **Search tab keeps Google and Bing in separate sub-tabs** — she rejected a combined table outright.
- **The GSC section heading is exactly "The real words people Googled"** — never "Search Console" (body copy may name it as the source). It belongs *under* the Google rankings table, not in its own sub-tab.
- **Instant Check pre-selects no chatbot** — a pre-ticked default once billed Gemini when she meant ChatGPT-only. It also must stay inside the Workspace sidebar (a standalone page lost it) and stay visually plain (she reverted a fancy hero restyle).
- **Only company/alias mentions are highlighted green in answers** — competitors deliberately not highlighted.
- **The GEO tab must keep saying no AI tool reveals the typed question** — the GA4 landing page of an AI-sourced visit is the closest real signal, and the copy has to say so.
- **Connections UX:** when a source is connected, hide the key input and offer only Disconnect; every save must verify live against the provider first (Bing `GetUserSites`, GA4 `ga4Sessions` probe) and give visible feedback.
- **Settings is a page, not a modal.** Onboarding is 3 steps with a step indicator.

## Before launch (deferred until closer to launch)
- **In-app whitelist for the public side** — Cloudflare Access already gates `/workspace /dashboard /instant-check /start /api` to two emails, but `/api/public-check` and `/api/demo-request` are deliberately open, so the landing's free check has no abuse limit yet.
- **Encrypt keys at rest** — scramble `connections.json` with a master secret from `.env.local`.

## What's missing next
- **Action Plan tab is a "Coming soon." placeholder.** The engine is done — `recommendActions` runs inside `runReport` and recommendations are saved on each snapshot — but `NextMoves` (`Workspace.tsx`) is never rendered; `ActionPlan` is. Wire `NextMoves` in; don't rebuild the generator.
- **Competitors tab is thin** — it shows estimated Google traffic when a snapshot has it, otherwise just a competitor list. Per-question rank detail already sits in each snapshot's `ranks`, unused.
