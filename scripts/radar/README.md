# Radar runner

`npm run radar:run` does one unattended radar run:

1. Asks RYO for its tool catalog (`tools/list`) and works from what is really there. The six known tools keep their jobs; a renamed one is matched by name and description; a new holder or safety tool feeds the holder check; anything else is called only when its arguments are obvious, and its reply is kept raw in the notebook.
2. Asks RYO about each coin (`market_overview` once, then `analyze_token`, `deep_analysis` and any safety tool per coin), spaced about 1.1 s apart to stay under RYO's 60 requests a minute.
3. Runs the agents (hunter, bull, bear, judge) and plans one practice trade per coin: entry at RYO's price, stop, take-profit and size as one decision. The risk desk accepts it only if every published limit passes. Missing data refuses the trade; it is never guessed.
4. Saves `data/radar/runs/<time>-<coins>.json`: the run with its full hash-chained notebook, every raw RYO reply (with time and latency), the catalog snapshot and the app version. The notebook stores a SHA-256 fingerprint of each raw reply, so the saved replies can be checked against it.
5. Updates the paper ledger `data/radar/ledger.json`: accepted trades open paper positions; each later run marks them to RYO's price and closes them at the stop, the take-profit, or after 7 days; the daily-loss circuit breaker stops new positions once today's realised losses reach the limit. Every ledger change is an entry in its own hash chain, and the positions and totals are re-derived from that chain when verified.

Coins that have an open position are always added to the list, so they keep being marked.

## Commands

```bash
# once a key exists (put it in .env.local, or export it)
RYO_MCP_KEY=ryo_mcp_... npm run radar:run                    # default coins: BTC ETH SOL XRP PEPE WIF
npm run radar:run -- BTC,ETH,BONK                             # your own list (max 12, open positions added)
npm run radar:run -- --trigger=schedule                       # mark the run as unattended in the ledger
RADAR_LIMITS='{"maxPositionUsd":500,"stopPct":15}' npm run radar:run   # other limits (validated and clamped)
```

`OPENROUTER_API_KEY` is optional: with it, the bull and bear write their arguments with a model; without it, rules write them. The verdict and the risk decision are rule-based either way.

Exit codes: `0` saved · `3` RYO unavailable (no key, server down, or no tool answered): **nothing is written** · `1` unexpected error.

## When RYO is unavailable

Nothing is saved and the ledger is not touched. A run file only ever holds data RYO really sent, so a gap run would be an empty file; open positions simply wait for the next real price. The reason is printed (and, on GitHub, written to the job summary with a warning), so outages stay visible without polluting the record.

## Unattended on GitHub

`.github/workflows/radar.yml` runs every 4 hours (minute 17) and on demand (Actions → radar → Run workflow, optional coin list). It needs:

- repo secret `RYO_MCP_KEY` (and optionally `OPENROUTER_API_KEY`): Settings → Secrets and variables → Actions;
- Settings → Actions → General → Workflow permissions → **Read and write** (the workflow also asks for `contents: write`).

On success it commits `data/radar/` as `github-actions[bot]` with the message `radar: run <time>`. On exit code 3 it commits nothing. GitHub pauses scheduled workflows in repos with no activity for 60 days; the commits themselves count as activity.

## Unattended on Windows (local alternative)

From the repo folder, with the key in `.env.local`, one line in PowerShell or cmd creates a task that runs every 4 hours:

```
schtasks /Create /SC HOURLY /MO 4 /TN "Canary radar" /TR "cmd /c cd /d C:\Users\daksh\canary && npm run radar:run -- --trigger=schedule >> %TEMP%\canary-radar.log 2>&1"
```

Run it now with `schtasks /Run /TN "Canary radar"`, remove it with `schtasks /Delete /TN "Canary radar" /F`. It saves locally; commit `data/radar/` yourself (or append `&& git add data/radar && git commit -m "radar: run" && git push` to the command).

## Checking a run

On `/radar`, open any saved run and press **Verify this run in your browser**: the notebook's hash chain is re-checked, and every raw RYO reply in the file is hashed and compared with the fingerprint the notebook recorded when it arrived. **Verify the ledger** re-checks the ledger chain and replays it to confirm the positions and totals. Neither needs a key.

The same files are served read-only at `/api/radar?runs=1`, `/api/radar?run=<file>` and `/api/radar?ledger=1`.

## What is never written

The key only travels in the `Authorization` header and is never stored. Before writing, the run and ledger are scanned for anything key-shaped (`ryo_mcp_…`, `sk-or-…`, bearer tokens, or the literal values of `RYO_MCP_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `INTERNAL_TOKEN`); if anything matches, saving is refused (redacting would break the fingerprints).

## Honest limits

- hanko's live check of RYO (2026-09-05) found no holder-concentration field in the six tools. Until RYO returns one, or a holder tool appears in the catalog, every practice trade is refused with "who holds the supply is unknown". That is the correct outcome under the published limits, not a bug.
- Prices are seen only when a run happens (every 4 hours), so a stop can fill below its level; the ledger records the observed price and says so. Take-profits fill at their level.
- The "Replay a recorded RYO response" button on `/radar` uses hanko's published test fixtures (MIT, cited in `tests/fixtures/ryo/hanko.json`). It is labelled as recorded sample data, never saved, and never touches the ledger.
