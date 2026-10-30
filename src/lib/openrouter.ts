// OpenRouter as a second way to reach Claude (set OPENROUTER_API_KEY instead of ANTHROPIC_API_KEY).
// Same model family, same prompts, same fact guards; only the transport differs.
// https://openrouter.ai/docs — OpenAI-compatible chat completions with JSON-schema structured output.

import { z } from "zod";

const URL_ = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_MODEL = () => process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-5.5";
export const openRouterConfigured = () => Boolean(process.env.OPENROUTER_API_KEY);

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public status: number | null,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

type Choice = { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string };

// After a billing or key error, every retry fails the same way and costs the caller seconds of silence on a
// live call. Pause the provider for a few minutes and let the deterministic fallbacks answer instantly.
let pausedUntil = 0;
export const openRouterPaused = () => Date.now() < pausedUntil;
export const resetOpenRouterPause = () => void (pausedUntil = 0);

async function post(body: Record<string, unknown>, signal: AbortSignal) {
  if (openRouterPaused()) throw new OpenRouterError("OpenRouter paused after a billing or key error", 402);
  const res = await fetch(URL_, {
    method: "POST",
    signal,
    headers: {
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "content-type": "application/json",
      // optional attribution headers OpenRouter shows on its dashboard
      ...(process.env.PUBLIC_SITE_URL ? { "HTTP-Referer": process.env.PUBLIC_SITE_URL } : {}),
      "X-Title": "Canary",
    },
    // Short, factual outputs don't need extended thinking; it would also eat the token budget and the credit.
    body: JSON.stringify({ model: OPENROUTER_MODEL(), reasoning: { enabled: false }, ...body }),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 402) pausedUntil = Date.now() + Number(process.env.LLM_PAUSE_SECONDS ?? 300) * 1000;
    throw new OpenRouterError(`OpenRouter ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`, res.status);
  }
  return res;
}

async function chat(body: Record<string, unknown>, timeoutMs = 90_000): Promise<Choice> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await post(body, ctrl.signal);
    const j = (await res.json()) as { choices?: Choice[]; error?: { message?: string } };
    if (j.error) throw new OpenRouterError(`OpenRouter: ${j.error.message ?? "error"}`, null);
    return j.choices?.[0] ?? {};
  } catch (err) {
    if (err instanceof OpenRouterError) throw err;
    throw new OpenRouterError(err instanceof Error ? err.message : "network error", null);
  } finally {
    clearTimeout(timer);
  }
}

const jsonFormat = (name: string, schema: z.ZodType) => ({ type: "json_schema", json_schema: { name, strict: true, schema: z.toJSONSchema(schema) } });
const parseWith = <T extends z.ZodType>(schema: T, text: string): z.infer<T> | null => {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** Structured output: the reply must match the schema, or we get null and the caller uses its deterministic fallback. */
export async function openRouterJson<T extends z.ZodType>(opts: { system: string; user: string; schema: T; name: string; maxTokens?: number }): Promise<z.infer<T> | null> {
  const choice = await chat({
    max_tokens: opts.maxTokens ?? 4000,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    response_format: jsonFormat(opts.name, opts.schema),
  });
  if (choice.message?.refusal || !choice.message?.content || choice.finish_reason === "length") return null;
  return parseWith(opts.schema, choice.message.content);
}

/**
 * Structured output, streamed: onText gets the JSON written so far, so a voice call can start speaking the
 * first sentence while the rest is still being written. Returns the parsed result at the end, or null.
 */
export async function openRouterJsonStream<T extends z.ZodType>(opts: {
  system: string;
  user: string;
  schema: T;
  name: string;
  maxTokens?: number;
  timeoutMs?: number;
  onText: (soFar: string) => void;
}): Promise<z.infer<T> | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90_000);
  try {
    const res = await post(
      {
        max_tokens: opts.maxTokens ?? 4000,
        stream: true,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        response_format: jsonFormat(opts.name, opts.schema),
      },
      ctrl.signal,
    );
    if (!res.body) return null;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    let finish: string | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        // server-sent events: "data: {...}", keep-alive comments start with ":"
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let j: { choices?: { delta?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[]; error?: { message?: string } };
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.error) throw new OpenRouterError(`OpenRouter: ${j.error.message ?? "error"}`, null);
        const ch = j.choices?.[0];
        if (ch?.delta?.refusal) return null;
        if (ch?.delta?.content) {
          text += ch.delta.content;
          opts.onText(text);
        }
        if (ch?.finish_reason) finish = ch.finish_reason;
      }
    }
    if (finish === "length" || finish === "content_filter") return null;
    return parseWith(opts.schema, text);
  } catch (err) {
    if (err instanceof OpenRouterError) throw err;
    throw new OpenRouterError(err instanceof Error ? err.message : "network error", null);
  } finally {
    clearTimeout(timer);
  }
}

/** Plain text reply, or null on refusal / empty output. */
export async function openRouterText(opts: { system: string; user: string; maxTokens?: number }): Promise<string | null> {
  const choice = await chat({
    max_tokens: opts.maxTokens ?? 3000,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });
  // a reply cut off mid-sentence must never reach a police report
  if (choice.message?.refusal || choice.finish_reason === "content_filter" || choice.finish_reason === "length") return null;
  return choice.message?.content?.trim() || null;
}
