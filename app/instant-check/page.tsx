import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Instant check lives inside the workspace now (so the sidebar is always there).
export default async function InstantCheckPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const { board } = await searchParams;
  redirect(`/workspace?tab=Instant+Check${board ? `&board=${board}` : ""}`);
}
