import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Served behind Apache reverse-proxy at https://clipper.speedero.com/SecApp
  // This branch (`clipper`) is Clipper-only; do not merge to main (would break Vercel).
  basePath: "/SecApp",
};

export default nextConfig;
