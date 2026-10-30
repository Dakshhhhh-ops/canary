import type { NextConfig } from "next";

// Microphone is allowed for this site only (talking to Doki); camera and location never.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // standalone is for self-hosting (EC2/Docker: node .next/standalone/server.js). Vercel packages its own
  // functions from the same traces, so it isn't needed there.
  output: process.env.VERCEL ? undefined : "standalone",
  // lets a production build run next to the dev server (NEXT_DIST_DIR=.next-build)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Files read at runtime from process.cwd() (src/lib/cases.ts, onchain.ts, radar/store.ts): the case files, the on-chain
  // proof summary, the CRE simulation log and saved radar runs. This ships them with every server function, which Vercel needs
  // (checked in .next/server/app/**/*.nft.json). Only an opt-in radar save (?save=1) writes, and it fails softly on Vercel.
  outputFileTracingIncludes: {
    "/**": ["./data/cases/**", "./data/onchain.json", "./cre/SIMULATION.md", "./data/radar/**", "./data/notebooks/**"],
    // the social card is rendered at build time; this only matters if it is ever rendered on demand
    "/(opengraph|twitter)-image": ["./src/app/_og/**"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
