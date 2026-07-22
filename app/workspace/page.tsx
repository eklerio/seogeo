import { redirect } from "next/navigation";
import { listDestinations } from "@/lib/store";
import { UNIT_COST } from "@/lib/report";
import Workspace, { type Tab } from "@/components/Workspace";

export const dynamic = "force-dynamic";

const VALID_TABS = ["Instant Check", "Overview", "GEO", "Search", "Competitors", "Action Plan"];

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; tab?: string }>;
}) {
  const { board, tab } = await searchParams;
  const all = await listDestinations();
  if (all.length === 0) redirect("/start");
  const active = all.find((d) => d.id === board) ?? all[all.length - 1];
  const initialTab: Tab = VALID_TABS.includes(tab ?? "") ? (tab as Tab) : "Overview";
  return (
    <Workspace
      destination={active}
      destinations={all}
      initialTab={initialTab}
      instantCosts={{
        chatgpt: UNIT_COST.chatgpt,
        gemini: UNIT_COST.gemini,
        perplexity: UNIT_COST.perplexity,
        claude: UNIT_COST.claude,
      }}
    />
  );
}
