import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The builder chat's API lookup reads each registered app's operation index at runtime
  // (custom-actions/lib/api-lookup.ts), from a path the trace can't follow.
  outputFileTracingIncludes: {
    "/api/builder/turn": ["./api-descriptions/*/operations.json.gz"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
      // Prompts are parsed at build time and bundled, never read from disk (src/lib/prompts.ts).
      "*.prompt.yml": {
        loaders: ["./prompt-loader.cjs"],
        as: "*.js",
      },
    },
  },
};

export default nextConfig;
