"use client";
import dynamic from "next/dynamic";
import type { Mood } from "./Mascot";

const Mascot = dynamic(() => import("./Mascot").then((m) => m.Mascot), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-full bg-[var(--canary-soft)]" />,
});

export function HeroDoki({ mood = "wave", className, distance }: { mood?: Mood; className?: string; distance?: number }) {
  return <Mascot mood={mood} className={className} distance={distance} />;
}
