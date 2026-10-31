// EthereumMax (EMAX): addresses only, for `npx tsx scripts/build-case.mts emax --compare`.
// The published data/cases/emax.json is built by scripts/build-emax.mts (unchanged). The parameters
// below are the ones that script uses, so the generic builder sends the identical requests (and hits
// the same local cache) and must reproduce the identical price series.
import { tmpdir } from "node:os";
import { join } from "node:path";

export const config = ({ fresh }: { fresh: boolean }) => ({
  rpc: process.env.RPC_URL ?? "https://mainnet.gateway.tenderly.co",
  cacheDir: join(tmpdir(), "canary-emax-cache"),
  fresh,
  token: "0x15874d65e649880c2614e7a480cb7c9a55787ff6",
  tokenDecimals: 18,
  pair: "0xb6ca52c7916ad7960c12dc489fd93e5af7ca257f",
  pairCreatedBlock: 12503000,
  factory: "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f",
  router: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
  quote: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  quoteDecimals: 18,
  usdPool: { pair: "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc", stable: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", stableDecimals: 6, factory: "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f" },
  searchLo: 12503000 - 200_000,
  searchHi: 13_500_000,
  seriesFrom: "2021-05-25",
  seriesTo: "2021-09-30",
});
