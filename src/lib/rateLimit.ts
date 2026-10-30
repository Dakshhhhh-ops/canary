// Simple per-IP limiter (in memory — enough for a single instance; swap for Redis/KV when scaling out).

const WINDOW_MS = 10 * 60 * 1000;

export function makeLimiter(maxPerWindow: number) {
  const hits = new Map<string, number[]>();
  return function limited(ip: string) {
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
    return recent.length > maxPerWindow;
  };
}

/**
 * The visitor's IP. Load balancers (AWS ALB, App Runner, nginx) append the address they saw to X-Forwarded-For,
 * so the trustworthy entry is counted from the end; the first entry can be typed by anyone to dodge the limit.
 * TRUSTED_PROXY_HOPS = how many proxies sit in front of the app (default 1).
 */
export function clientIp(req: Request) {
  const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? 1) || 1);
  const chain = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (chain.length) return chain[Math.max(0, chain.length - hops)];
  return req.headers.get("x-real-ip") || "local";
}
