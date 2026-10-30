"use client";
import { useGuide } from "./Guide";

export function TourButton({ className, children }: { className?: string; children: React.ReactNode }) {
  const guide = useGuide();
  return (
    <button type="button" className={className} onClick={() => guide?.startTour()}>
      {children}
    </button>
  );
}
