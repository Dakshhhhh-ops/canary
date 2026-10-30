// Minimal Blockscout v2 client, one instance per chain. Free public APIs; optional PRO key.
// Docs: https://eth.blockscout.com/api-docs

import { apiBase, apiKey, type ChainId } from "./chains";

export type BsTag = { name: string; slug: string; tagType: string; meta?: Record<string, unknown> };

export type BsAddressRef = {
  hash: string;
  name: string | null;
  is_contract: boolean;
  is_scam?: boolean;
  reputation?: string;
  proxy_type?: string | null;
  metadata?: { tags?: BsTag[] } | null;
};

export type BsTx = {
  hash: string;
  timestamp: string;
  block_number: number;
  from: BsAddressRef;
  to: BsAddressRef | null;
  value: string;
  status: string | null;
  method: string | null;
  result?: string;
};

export type BsTokenTransfer = {
  transaction_hash: string;
  timestamp: string;
  block_number: number;
  log_index: number;
  from: BsAddressRef;
  to: BsAddressRef;
  token: {
    address_hash?: string;
    address?: string;
    symbol: string | null;
    name: string | null;
    decimals: string | null;
    type: string;
    exchange_rate?: string | null;
    holders_count?: string | null;
  };
  total: { value?: string; decimals?: string | null; token_id?: string } | null;
};

export type BsInternalTx = {
  transaction_hash: string;
  timestamp: string;
  from: BsAddressRef;
  to: BsAddressRef | null;
  value: string;
  success: boolean;
};

export type BsAddress = BsAddressRef & {
  coin_balance: string | null;
  exchange_rate: string | null;
};

type Page<T> = { items: T[]; next_page_params: Record<string, string | number> | null };

// Shared across chains: one cache (keys are full URLs) and one global concurrency limiter.
const cache = new Map<string, Promise<unknown>>();
let inFlight = 0;
const MAX_CONCURRENT = 4;
const REQUEST_TIMEOUT_MS = 20_000;
const queue: (() => void)[] = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_CONCURRENT) await new Promise<void>((r) => queue.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    queue.shift()?.();
  }
}

export class BlockscoutError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly path: string,
  ) {
    super(message);
    this.name = "BlockscoutError";
  }
}

function qs(params: Record<string, string | number | null | undefined>) {
  const s = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return s ? `?${s}` : "";
}

function makeClient(base: string, key: string | null) {
  async function get<T>(path: string): Promise<T> {
    const url = base + path + (key ? `${path.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(key)}` : "");
    const hit = cache.get(url);
    if (hit) return hit as Promise<T>;
    const p = slot(async () => {
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        } catch (err) {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
            continue;
          }
          throw new BlockscoutError(`Blockscout unreachable for ${path}: ${err instanceof Error ? err.message : err}`, null, path);
        }
        if (res.ok) return (await res.json()) as T;
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
        throw new BlockscoutError(`Blockscout ${res.status} for ${path}`, res.status, path);
      }
    });
    cache.set(url, p);
    p.catch(() => cache.delete(url));
    return p;
  }

  /** Fetch pages (newest first) until `stopWhen` says we've gone back far enough. */
  async function pages<T>(path: string, params: Record<string, string>, stopWhen: (item: T) => boolean, maxPages = 4): Promise<T[]> {
    const out: T[] = [];
    let next: Record<string, string | number> | null = null;
    for (let i = 0; i < maxPages; i++) {
      const page: Page<T> = await get<Page<T>>(path + qs({ ...params, ...(next ?? {}) }));
      out.push(...page.items);
      if (!page.next_page_params || page.items.some(stopWhen)) break;
      next = page.next_page_params;
    }
    return out;
  }

  return {
    base,
    tx: (hash: string) => get<BsTx>(`/transactions/${hash}`),
    txTokenTransfers: (hash: string) => pages<BsTokenTransfer>(`/transactions/${hash}/token-transfers`, {}, () => false, 4),
    txInternal: (hash: string) => pages<BsInternalTx>(`/transactions/${hash}/internal-transactions`, {}, () => false, 6),
    address: (addr: string) => get<BsAddress>(`/addresses/${addr}`),
    /** Network stats; `coin_price` is the native asset's USD price. */
    stats: () => get<{ coin_price: string | null }>(`/stats`),
    /** Outgoing native txs from addr, newest first, back to `since`. */
    outgoingTxs: (addr: string, since: number) =>
      pages<BsTx>(`/addresses/${addr}/transactions`, { filter: "from" }, (t) => Date.parse(t.timestamp) < since),
    outgoingTokenTransfers: (addr: string, since: number) =>
      pages<BsTokenTransfer>(`/addresses/${addr}/token-transfers`, { filter: "from", type: "ERC-20" }, (t) => Date.parse(t.timestamp) < since),
    /** Native coin reaching addr via contract calls (e.g. DEX swap payouts). */
    incomingInternal: (addr: string, since: number) =>
      pages<BsInternalTx>(`/addresses/${addr}/internal-transactions`, { filter: "to" }, (t) => Date.parse(t.timestamp) < since, 2),
    incomingTokenTransfers: (addr: string, since: number) =>
      pages<BsTokenTransfer>(`/addresses/${addr}/token-transfers`, { filter: "to", type: "ERC-20" }, (t) => Date.parse(t.timestamp) < since, 2),
    /** The newest outgoing native txs from addr (one page, no paging). */
    latestOutgoingTxs: (addr: string) => get<Page<BsTx>>(`/addresses/${addr}/transactions?filter=from`).then((p) => p.items),
    /** The newest ERC-20 transfers out of addr (one page) — includes thefts the thief sent using an approval. */
    latestOutgoingTokenTransfers: (addr: string) =>
      get<Page<BsTokenTransfer>>(`/addresses/${addr}/token-transfers?filter=from&type=ERC-20`).then((p) => p.items),
    tokenBalances: (addr: string) => get<{ token: BsTokenTransfer["token"]; value: string }[]>(`/addresses/${addr}/token-balances`),
  };
}

export type BlockscoutClient = ReturnType<typeof makeClient>;

const clients = new Map<string, BlockscoutClient>();

/** Client for a chain (cached per API base URL). */
export function blockscoutFor(chain: ChainId): BlockscoutClient {
  const base = apiBase(chain);
  const key = apiKey();
  const id = `${base}|${key ?? ""}`;
  let c = clients.get(id);
  if (!c) clients.set(id, (c = makeClient(base, key)));
  return c;
}

/** Ethereum mainnet client (backward compatible default). */
export const blockscout: BlockscoutClient = new Proxy({} as BlockscoutClient, {
  get: (_t, prop) => blockscoutFor("ethereum")[prop as keyof BlockscoutClient],
});

export const tokenAddress = (t: BsTokenTransfer["token"]) => (t.address_hash ?? t.address ?? "").toLowerCase();
