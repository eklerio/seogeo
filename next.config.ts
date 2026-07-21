import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The preview link is served from a rotating *.trycloudflare.com host.
  // Allow it so the dev server's live updates and assets reach the browser.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
