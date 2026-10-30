import { loadCase } from "@/lib/cases";
import { caseRunStream } from "@/lib/engine/pipeline";
import { stepClock } from "@/lib/engine/trail";
import { clientIp, makeLimiter } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limited = makeLimiter(Number(process.env.CASE_RUNS_PER_10_MIN) || 30);

// Streams the agents' run over a documented case as server-sent events: one "step" per trail entry, then "done".
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cf = await loadCase(slug);
  if (!cf) return Response.json({ error: "No such case." }, { status: 404 });
  if (limited(clientIp(req))) return Response.json({ error: "Too many runs from here. Try again in a few minutes." }, { status: 429 });
  // ?ai=0 forces the rule-based agents; the default tries the model and falls back to rules (recorded as a gap)
  const llm = new URL(req.url).searchParams.get("ai") === "0" ? null : "auto";
  const stream = caseRunStream(cf, { llm, clock: stepClock("2026-10-30T00:00:00.000Z") });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
  });
}
