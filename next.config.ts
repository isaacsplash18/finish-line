import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stop `next dev` regenerating AGENTS.md / CLAUDE.md in the repo root.
  agentRules: false,
};

export default nextConfig;
