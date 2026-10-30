// POST { step, text } -> fields an LLM read from a free-text answer, each checked against the caller's words
// and the case file (src/lib/hotline/extract.ts). Optional: with no OpenRouter key or credit it returns {}.
// Name and email steps are refused, so those never leave the browser.
import { NextResponse } from "next/server";
import { loadCase } from "@/lib/cases";
import { toHotlineCase } from "@/lib/hotline/caseFacts";
import { EXTRACT_SYSTEM, EXTRACTABLE, ExtractSchema, guardExtract } from "@/lib/hotline/extract";
import type { StepId } from "@/lib/hotline/agent";
import { openRouterConfigured, openRouterJson, openRouterPaused } from "@/lib/openrouter";
import { clientIp, makeLimiter } from "@/lib/rateLimit";

export const runtime = "nodejs";
const limited = makeLimiter(40);

export async function POST(req: Request) {
  if (limited(clientIp(req))) return NextResponse.json({ fields: {}, llm: false }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { step?: string; text?: string };
  const text = String(body.text ?? "").slice(0, 500);
  if (!text || !EXTRACTABLE.includes(body.step as StepId)) return NextResponse.json({ fields: {}, llm: false });
  if (!openRouterConfigured() || openRouterPaused()) return NextResponse.json({ fields: {}, llm: false });
  const cf = await loadCase("emax");
  if (!cf) return NextResponse.json({ fields: {}, llm: false });
  const k = toHotlineCase(cf);
  try {
    const raw = await openRouterJson({ system: EXTRACT_SYSTEM(k), user: `Question topic: ${body.step}\nAnswer: ${text}`, schema: ExtractSchema, name: "hotline_fields", maxTokens: 300 });
    return NextResponse.json({ fields: guardExtract(raw, text, k), llm: true });
  } catch {
    return NextResponse.json({ fields: {}, llm: false });
  }
}
