import Landing from "@/components/Landing";

export const dynamic = "force-dynamic";

// Public landing page — shown to everyone at the root URL. The private app lives at
// /workspace, and first-time onboarding at /start.
export default function Home() {
  return <Landing />;
}
