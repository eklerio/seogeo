import { redirect } from "next/navigation";
import { listDestinations } from "@/lib/store";
import SettingsView, { type SettingsSection } from "@/components/SettingsView";

export const dynamic = "force-dynamic";

const SECTIONS: SettingsSection[] = ["site", "ai", "connections", "danger"];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; section?: string }>;
}) {
  const { board, section } = await searchParams;
  const all = await listDestinations();
  if (all.length === 0) redirect("/");
  const active = all.find((d) => d.id === board) ?? all[all.length - 1];
  const initialSection = SECTIONS.includes(section as SettingsSection)
    ? (section as SettingsSection)
    : "site";
  return (
    <SettingsView destination={active} destinations={all} initialSection={initialSection} />
  );
}
