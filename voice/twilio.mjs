// Small, dependency-free helpers for the Twilio phone line (kept separate so they can be unit-tested).

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio signs every webhook: HMAC-SHA1 over the full URL followed by each POST parameter
 * (sorted by name, name + value concatenated), keyed with the account's auth token, base64-encoded.
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validTwilioSignature(authToken, signature, url, params = {}) {
  if (!authToken || !signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  const expected = createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Which language to greet a caller in, from their number. They can switch at any time by speaking another language. */
export function langFromNumber(from = "") {
  const n = String(from).replace(/[^\d+]/g, "");
  if (n.startsWith("+91")) return "hi";
  if (/^\+(34|52|54|56|57|51|58|593|502|503|504|505|506|507|591|595|598|53|1787)/.test(n)) return "es";
  return "en";
}

export const SPEECH = { en: "en-US", hi: "hi-IN", es: "es-ES" };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * TwiML that hands the call to Twilio ConversationRelay: Twilio does speech-to-text and text-to-speech
 * (with barge-in), and streams the caller's words to our WebSocket.
 * https://www.twilio.com/docs/voice/conversationrelay
 */
export function conversationRelayTwiml({ wsUrl, greeting, lang }) {
  const languages = Object.values(SPEECH)
    .map((code) => `<Language code="${code}"/>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Connect>` +
    `<ConversationRelay url="${esc(wsUrl)}" language="${SPEECH[lang] ?? SPEECH.en}" welcomeGreeting="${esc(greeting)}" interruptible="any" dtmfDetection="false">` +
    languages +
    `<Parameter name="lang" value="${esc(lang)}"/>` +
    `</ConversationRelay>` +
    `</Connect></Response>`
  );
}
