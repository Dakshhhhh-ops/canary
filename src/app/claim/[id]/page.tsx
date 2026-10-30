import type { Metadata } from "next";
import { Footer, Header } from "@/components/Chrome";
import { ClaimPackView } from "@/components/call/ClaimPackView";

export const metadata: Metadata = {
  title: "Your claim pack · Canary",
  description: "Drafted complaints, the class action note and your evidence file. Stored only in your browser.",
  robots: { index: false },
};

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const safe = /^[a-z0-9]{6,24}$/.test(id) ? id : "";
  return (
    <>
      <Header />
      <div className="grain min-h-[60vh]">
        <ClaimPackView id={safe} />
      </div>
      <Footer />
    </>
  );
}
