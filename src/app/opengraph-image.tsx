import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

// Social preview card (also used for Twitter/X via twitter-image.tsx). Rendered once at build time with the site's
// own fonts (TTF copies in src/app/_og, SIL Open Font License), so it needs no network.
export const alt = "Canary: catch the pump before it dumps. Agents, Chainlink and a voice hotline against crypto pump-and-dumps.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#2a190e";
const PAPER = "#fff8ea";

const font = (file: string) => readFile(path.join(process.cwd(), "src", "app", "_og", file));

export default async function OpengraphImage() {
  const [display, serif, sans] = await Promise.all([font("bricolage-800.ttf"), font("instrument-serif-italic.ttf"), font("geist-600.ttf")]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: PAPER,
          backgroundImage: "radial-gradient(rgba(186, 92, 37, 0.10) 2px, transparent 2px)",
          backgroundSize: "28px 28px",
          color: INK,
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* the Canary logo from src/components/Chrome.tsx */}
          <svg viewBox="0 0 64 64" width="96" height="96">
            <circle cx="32" cy="34" r="24" fill="#ffd84d" stroke="#ba5c25" strokeWidth="3" />
            <ellipse cx="25" cy="31" rx="3" ry="4.5" fill="#773d26" />
            <ellipse cx="39" cy="31" rx="3" ry="4.5" fill="#773d26" />
            <path d="M28 37 L32 43 L36 37 Z" fill="#fe6a28" />
            <circle cx="19" cy="38" r="3" fill="#fea759" opacity=".8" />
            <circle cx="45" cy="38" r="3" fill="#fea759" opacity=".8" />
          </svg>
          <span style={{ fontSize: 60, fontWeight: 800, letterSpacing: "-0.03em", fontFamily: "Bricolage" }}>Canary</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", fontFamily: "Bricolage" }}>
          <div style={{ display: "flex", fontSize: 92, fontWeight: 800, lineHeight: 1.02, letterSpacing: "-0.035em" }}>Catch the pump</div>
          <div style={{ display: "flex", fontSize: 92, fontWeight: 800, lineHeight: 1.02, letterSpacing: "-0.035em" }}>
            <span style={{ fontStyle: "italic", fontWeight: 400, color: "#ba5c25", marginRight: 24, fontFamily: "Instrument Serif", fontSize: 104 }}>before</span>
            <span
              style={{
                display: "flex",
                padding: "0 8px",
                backgroundImage: "linear-gradient(transparent 58%, #ffd84d 58%, #ffd84d 92%, transparent 92%)",
              }}
            >
              it dumps.
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 30,
              fontWeight: 600,
              padding: "12px 26px",
              borderRadius: 999,
              border: `3px solid ${INK}`,
              background: "#ffffff",
              boxShadow: `0 6px 0 ${INK}`,
            }}
          >
            Agents · Chainlink · Voice hotline
          </div>
          <span style={{ fontSize: 24, color: "#5c4330" }}>BLI Legal Tech Hackathon 2</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Bricolage", data: display, weight: 800, style: "normal" },
        { name: "Instrument Serif", data: serif, weight: 400, style: "italic" },
        { name: "Geist", data: sans, weight: 600, style: "normal" },
      ],
    },
  );
}
