import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Served behind Apache reverse-proxy at https://clipper.speedero.com/SecApp
  // This branch (`clipper`) is Clipper-only; do not merge to main (would break Vercel).
  basePath: "/SecApp",

  // Minimal self-contained server for Clipper deploys. CI builds on Linux (matching
  // the server) and rsyncs just the standalone output; the server never runs `next build`.
  output: "standalone",

  // Pin workspace root so standalone traces files from this project, not a parent
  // directory that happens to contain a stray lockfile.
  outputFileTracingRoot: path.resolve(__dirname),
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
