// Canary phone line: a Twilio ConversationRelay WebSocket server that drives the same hotline engine as the web call.
//
//   caller ── phone ──► Twilio (speech ⇄ text, barge-in) ──WebSocket──► this relay ──HTTP──► Canary app
//
// Each finished sentence from the caller goes to POST /api/hotline/turn with the call's state (the engine is
// stateless, src/lib/hotline/agent.ts). When the engine asks for a blockchain check, the relay calls
// /api/hotline/purchases and feeds the result back. Claim packs are built in a browser, so at the end the caller
// is pointed to the website; nothing personal is stored here and nothing is logged except errors.
//
// Env: APP_URL (default http://127.0.0.1:3100), PUBLIC_URL (https://your-domain), VOICE_PORT (3001),
//      TWILIO_AUTH_TOKEN (signed webhooks), INTERNAL_TOKEN (optional, skips the app's per-IP limit).
// Run: node voice/relay.mjs   (needs the `ws` package)

import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { conversationRelayTwiml, validTwilioSignature } from "./twilio.mjs";

const APP = (process.env.APP_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const PUBLIC = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const PORT = Number(process.env.VOICE_PORT || 3001);
const AUTH = process.env.TWILIO_AUTH_TOKEN || "";
const INTERNAL = process.env.INTERNAL_TOKEN || "";
const log = (...a) => console.log(new Date().toISOString(), "[voice]", ...a);
// Without Twilio's auth token we can't tell Twilio from anyone else, so the relay stays closed unless opened for local testing.
const OPEN = Boolean(AUTH) || process.env.VOICE_ALLOW_UNSIGNED === "1";

async function app(path, body) {
  const res = await fetch(APP + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(INTERNAL ? { "x-internal-token": INTERNAL } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 400 && res.status !== 502) throw new Error(`${path} ${res.status}`);
  return res.json();
}

const PHONE_END =
  "On the phone I can't hand you the documents. Open Canary's website and press Call the hotline: it takes two minutes, and your documents are made on your own device. Thank you for calling, and remember, never pay anyone to recover your money.";

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b.length < 20_000 ? (b += c) : req.destroy()));
    req.on("end", () => resolve(b));
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/voice/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, open: OPEN, signed: Boolean(AUTH) }));
  }
  if (req.method === "POST" && url.pathname === "/voice/incoming") {
    if (!OPEN) {
      res.writeHead(503, { "content-type": "text/plain" });
      return res.end("Phone line not configured: set TWILIO_AUTH_TOKEN");
    }
    const params = Object.fromEntries(new URLSearchParams(await readBody(req)));
    if (AUTH && !validTwilioSignature(AUTH, req.headers["x-twilio-signature"], `${PUBLIC}${url.pathname}`, params)) {
      res.writeHead(403);
      return res.end();
    }
    let greeting = "Hi, this is Doki from Canary. Which coin did you buy?";
    try {
      greeting = (await app("/api/hotline/turn", {})).reply.say.join(" ");
    } catch (e) {
      log("greeting fallback:", e.message);
    }
    res.writeHead(200, { "content-type": "text/xml" });
    return res.end(conversationRelayTwiml({ wsUrl: `${PUBLIC.replace(/^http/, "ws")}/voice/relay`, greeting, lang: "en" }));
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname !== "/voice/relay" || !OPEN) return socket.destroy();
  if (AUTH && !validTwilioSignature(AUTH, req.headers["x-twilio-signature"], `${PUBLIC.replace(/^http/, "ws")}${req.url}`)) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});

wss.on("connection", (ws) => {
  const call = { state: null, busy: false, queue: [], ended: false };
  const out = (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  const say = (text) => out({ type: "text", token: text, last: true });

  async function handle(turn) {
    call.state = turn.state;
    say(turn.reply.say.join(" "));
    if (turn.reply.action?.type === "check-wallet") {
      let purchases;
      try {
        const { address, cases } = turn.reply.action;
        const j = await app("/api/hotline/purchases", cases ? { address, cases } : { address, caseSlug: call.state.caseSlug });
        purchases = j.ok ? { ok: true, report: j.report } : { ok: false, error: j.error || "failed" };
      } catch (e) {
        purchases = { ok: false, error: e.message };
      }
      await handle(await app("/api/hotline/turn", { state: call.state, purchases }));
    } else if (turn.reply.action?.type === "make-claim") {
      call.ended = true;
      say(PHONE_END);
      setTimeout(() => out({ type: "end" }), 1500 + PHONE_END.length * 75);
    }
  }

  async function turn(text) {
    if (call.busy) return void call.queue.push(text);
    call.busy = true;
    try {
      await handle(await app("/api/hotline/turn", { state: call.state, text }));
    } catch (e) {
      log("turn failed:", e.message);
      say("Sorry, I didn't catch that. Could you say it again?");
    } finally {
      call.busy = false;
      const next = call.queue.shift();
      if (next && !call.ended) turn(next);
    }
  }

  ws.on("message", async (raw) => {
    let m;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.type === "setup") {
      try {
        call.state = (await app("/api/hotline/turn", {})).state;
      } catch (e) {
        log("setup failed:", e.message);
      }
    } else if (m.type === "prompt" && m.last !== false && m.voicePrompt?.trim() && !call.ended) {
      turn(m.voicePrompt.trim());
    } else if (m.type === "error") {
      log("twilio error:", m.description);
    }
  });
});

server.listen(PORT, () => log(`listening on :${PORT} (app ${APP}, public ${PUBLIC || "unset"}, signed webhooks ${AUTH ? "on" : "OFF"})`));
