import { redirect } from "next/navigation";
import { getActiveDestination } from "@/lib/store";
import Onboarding from "@/components/Onboarding";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; connect?: string; google?: string; reason?: string }>;
}) {
  const { new: addBoard, connect, google, reason } = await searchParams;
  const active = await getActiveDestination();
  if (active && !addBoard && !connect) redirect("/workspace");
  return (
    <Onboarding
      addBoard={!!addBoard}
      initialStep={connect ? "connect" : "url"}
      googleResult={google === "ok" ? "ok" : google ? (reason ?? "exchange_failed") : null}
    />
  );
}
