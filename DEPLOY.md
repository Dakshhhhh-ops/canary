# Deploying Canary

Canary is a plain Next.js 15 app. Nothing writes to disk at runtime (case files, `data/onchain.json` and
`cre/SIMULATION.md` are read-only and bundled with every server function), so it runs on Vercel's serverless
functions as-is. Every environment variable is optional: with none set, the agents use their published rules,
the hotline uses its scripted engine, and missing sources are recorded as gaps.

## Vercel (recommended)

```bash
npm i -g vercel            # or use npx vercel
vercel login
vercel link                # in the project folder; creates .vercel/ (git-ignored)
# add the variables you have (see the table below), for Production (and Preview if you want):
vercel env add OPENROUTER_API_KEY production
vercel env add RYO_MCP_KEY production
# ...
vercel deploy --prod       # builds on Vercel and prints the URL
```

Or from the dashboard: **Add New → Project → Import** the Git repo, framework is detected as Next.js, paste the
variables under **Environment Variables**, **Deploy**. Any later push to the production branch redeploys.

After the first deploy:

1. Set `NEXT_PUBLIC_SITE_URL` to the final URL (e.g. `https://canary.example.org`) and redeploy, so the social
   preview cards use absolute links. Without it, Vercel's production URL is used automatically.
2. Open `/`, `/case/emax` (press **Run the agents**), `/call?demo=1`, `/verify`, `/radar` and `/judges`.
3. Paste the URL into a link-preview checker (e.g. opengraph.xyz) to see the card.

**Custom domain (optional):** Project → Settings → Domains → add `your-domain`, then add the DNS record Vercel shows
(an `A` record to `76.76.21.21` for an apex domain, or a `CNAME` to `cname.vercel-dns.com` for a subdomain). HTTPS
is automatic. Then set `NEXT_PUBLIC_SITE_URL` to it and redeploy.

### What vercel.json sets

- `maxDuration` 120 s for the streaming routes (`/api/case/[slug]/run`, `/api/radar`: the agents' server-sent
  events) and 60 s for the hotline, claims, registry and watch routes (blockchain lookups can take ~10 s).
  Hobby allows up to 300 s with Fluid compute, which is on by default for new projects. If you turned Fluid
  compute off, Hobby's ceiling is 60 s: lower the two 120 values to 60 or the deploy is rejected.
- The SSE responses already send `cache-control: no-cache, no-transform` and `x-accel-buffering: no`, and run on
  the Node.js runtime, so Vercel streams them event by event.

`next.config.ts` builds `output: "standalone"` everywhere except on Vercel (where `VERCEL=1` is set), since Vercel
packages its own functions.

### Environment variables

| Variable | Needed for | Required? |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | AI-written Bull/Bear/Judge arguments and the hotline's language understanding | Optional (rule-based fallback) |
| `OPENROUTER_MODEL` | Override the model (default `anthropic/claude-haiku-5.5`) | Optional |
| `RYO_MCP_KEY` | Live radar market data (`/radar`) | Optional (radar reports the gap) |
| `RYO_MCP_URL` | Override the RYO endpoint | Optional |
| `RPC_URL` | Ethereum mainnet archive RPC for the hotline's purchase lookup | Optional (public Tenderly gateway by default) |
| `BLOCKSCOUT_URL`, `BLOCKSCOUT_API_KEY` | Faster/keyed Blockscout lookups for wallet histories | Optional |
| `CANARY_REGISTRY_ADDRESS`, `CANARY_REGISTRY_FROM_BLOCK` | Reading the CanaryRegistry on Sepolia | Optional (needed to show on-chain status) |
| `SEPOLIA_RPC_URL` | Sepolia RPC (default publicnode) | Optional |
| `CANARY_RELAYER_KEY` | Sealing a claim fingerprint on Sepolia (`/api/claims/anchor`). **Server-side secret; Sepolia test wallet only** | Optional |
| `NEXT_PUBLIC_SITE_URL` | Absolute URLs in the social preview cards | Recommended |
| `PUBLIC_SITE_URL` | `HTTP-Referer` sent to OpenRouter | Optional |
| `INTERNAL_TOKEN` | Shared secret so the phone relay skips the per-IP limit | Only with the phone relay |
| `CASE_RUNS_PER_10_MIN`, `RADAR_RUNS_PER_10_MIN` | Per-IP rate limits (30 / 10) | Optional |
| `TRUSTED_PROXY_HOPS` | Proxies in front of the app (default 1, correct for Vercel) | Optional |
| `LLM_PAUSE_SECONDS` | Back-off after an OpenRouter 401/402 (default 300) | Optional |
| `RADAR_DATA_DIR`, `RADAR_UI_SAVE` | Where saved radar runs go / `0` turns the save option off | Optional |

Never prefix a secret with `NEXT_PUBLIC_`: those are sent to the browser.

### Limits to know on serverless

- Rate limits are kept in memory per function instance, so on Vercel they are per instance, not global. Fine for a
  demo; use Vercel KV/Upstash if it needs to hold under load.
- The **phone line** (`voice/relay.mjs`, a Twilio ConversationRelay WebSocket server) is a long-running process and
  can't run on Vercel. Run it on a small VM (below) with `APP_URL=https://<your vercel url>`, `PUBLIC_URL`,
  `TWILIO_AUTH_TOKEN` and the same `INTERNAL_TOKEN` as the app. The web hotline at `/call` needs none of this.
- **Saved radar runs** (`/api/radar?save=1`, `src/lib/radar/store.ts`) write to `data/radar/` on disk. Vercel's
  filesystem is read-only, so on Vercel that save fails softly (the run still streams; it reports "could not
  save"). Runs you saved locally and committed are bundled and still listed. To keep saving on Vercel, point
  `RADAR_DATA_DIR` at `/tmp/radar` (temporary, per instance) or move the store to Vercel Blob/KV; on EC2 it just works.
- `npm run chain:*` scripts and the CRE workflow run from your machine, not on Vercel. Commit the
  `data/onchain.json` and `cre/SIMULATION.md` they produce and redeploy to show them on `/judges`.

## Alternative: AWS EC2 (or any VM)

```bash
# Ubuntu, Node 22+; open ports 80/443 in the security group
git clone <repo> canary && cd canary && npm ci
cp .env.example .env.local && nano .env.local          # add the keys you have
npm run build
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/   # standalone doesn't copy these
cd .next/standalone                                     # data/cases etc. are already traced in && PORT=3000 HOSTNAME=0.0.0.0 node server.js   # run under pm2 or systemd
```

Put Caddy (`reverse_proxy localhost:3000`, automatic HTTPS) or nginx in front. With nginx, keep
`proxy_buffering off` for `/api/case/` and `/api/radar` so the agents' events stream, and set
`TRUSTED_PROXY_HOPS=1`. The phone relay runs on the same box: `node voice/relay.mjs` (port 3001) behind the
same proxy as a WebSocket upgrade.
