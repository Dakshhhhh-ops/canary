// EVM chains Golden Hour can trace, all via Blockscout's v2 REST API.
//
// Public instances: Ethereum, Optimism and Gnosis answer server-side requests freely.
// base/arbitrum/polygon.blockscout.com sit behind a Cloudflare challenge for many server IPs,
// so they're tried but may be "unavailable". Setting BLOCKSCOUT_API_KEY switches every chain to
// Blockscout's PRO API (https://api.blockscout.com/{chainId}/api/v2), which isn't gated.

export type ChainId = "ethereum" | "base" | "arbitrum" | "optimism" | "polygon" | "gnosis";

export type Chain = {
  id: ChainId;
  name: string;
  chainId: number;
  api: string; // public Blockscout v2 base, no trailing slash
  explorer: string; // human-facing explorer for links in documents
  native: { symbol: string; decimals: 18 };
};

export const CHAINS: Record<ChainId, Chain> = {
  ethereum: {
    id: "ethereum",
    name: "Ethereum",
    chainId: 1,
    api: "https://eth.blockscout.com/api/v2",
    explorer: "https://eth.blockscout.com",
    native: { symbol: "ETH", decimals: 18 },
  },
  base: {
    id: "base",
    name: "Base",
    chainId: 8453,
    api: "https://base.blockscout.com/api/v2",
    explorer: "https://base.blockscout.com",
    native: { symbol: "ETH", decimals: 18 },
  },
  arbitrum: {
    id: "arbitrum",
    name: "Arbitrum One",
    chainId: 42161,
    api: "https://arbitrum.blockscout.com/api/v2",
    explorer: "https://arbitrum.blockscout.com",
    native: { symbol: "ETH", decimals: 18 },
  },
  optimism: {
    id: "optimism",
    name: "OP Mainnet",
    chainId: 10,
    api: "https://explorer.optimism.io/api/v2",
    explorer: "https://explorer.optimism.io",
    native: { symbol: "ETH", decimals: 18 },
  },
  polygon: {
    id: "polygon",
    name: "Polygon PoS",
    chainId: 137,
    api: "https://polygon.blockscout.com/api/v2",
    explorer: "https://polygon.blockscout.com",
    native: { symbol: "POL", decimals: 18 },
  },
  gnosis: {
    id: "gnosis",
    name: "Gnosis",
    chainId: 100,
    api: "https://gnosis.blockscout.com/api/v2",
    explorer: "https://gnosis.blockscout.com",
    native: { symbol: "xDAI", decimals: 18 },
  },
};

/** Order matters: the first chain that has the tx wins. */
export const CHAIN_ORDER: ChainId[] = ["ethereum", "base", "arbitrum", "optimism", "polygon", "gnosis"];

export const isChainId = (v: unknown): v is ChainId => typeof v === "string" && v in CHAINS;

/** Where API calls for a chain actually go (env overrides / PRO API). */
export function apiBase(chain: ChainId): string {
  const key = process.env.BLOCKSCOUT_API_KEY;
  if (chain === "ethereum" && process.env.BLOCKSCOUT_URL) return process.env.BLOCKSCOUT_URL.replace(/\/$/, "");
  if (key) return `https://api.blockscout.com/${CHAINS[chain].chainId}/api/v2`;
  return CHAINS[chain].api;
}

export const apiKey = () => process.env.BLOCKSCOUT_API_KEY || null;

export type ChainLookup = { chain: ChainId | null; unavailable: ChainId[]; checked: ChainId[] };

/**
 * Find which chain a transaction hash lives on: query every chain in parallel,
 * prefer the earliest in CHAIN_ORDER. Chains that error/are gated are reported as unavailable.
 */
export async function findChain(txHash: string, chains: ChainId[] = CHAIN_ORDER): Promise<ChainLookup> {
  const results = await Promise.all(
    chains.map(async (id) => {
      try {
        const url = `${apiBase(id)}/transactions/${txHash}${apiKey() ? `?apikey=${encodeURIComponent(apiKey()!)}` : ""}`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15_000);
        const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: ctrl.signal }).finally(() =>
          clearTimeout(timer),
        );
        if (res.ok) {
          const j = (await res.json().catch(() => null)) as { hash?: string } | null;
          return { id, state: j?.hash ? ("found" as const) : ("missing" as const) };
        }
        if (res.status === 404 || res.status === 422) return { id, state: "missing" as const };
        return { id, state: "unavailable" as const };
      } catch {
        return { id, state: "unavailable" as const };
      }
    }),
  );
  return {
    chain: results.find((r) => r.state === "found")?.id ?? null,
    unavailable: results.filter((r) => r.state === "unavailable").map((r) => r.id),
    checked: results.filter((r) => r.state !== "unavailable").map((r) => r.id),
  };
}

export function listNames(ids: ChainId[]) {
  const names = ids.map((i) => CHAINS[i].name);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
