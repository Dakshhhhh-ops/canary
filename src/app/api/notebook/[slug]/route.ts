import { loadNotebook } from "@/lib/notebooks";

export const runtime = "nodejs";

// The frozen notebook whose fingerprint is recorded on-chain. Download it and drop it on /verify.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const nb = await loadNotebook(slug);
  if (!nb) return Response.json({ error: "No frozen notebook for this case." }, { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  return new Response(JSON.stringify(nb, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      ...(download ? { "content-disposition": `attachment; filename="canary-${slug}-notebook-${nb.headHash.slice(0, 8)}.json"` } : {}),
    },
  });
}
