import { isStaff } from "@parvaordo/shared";
import { NextResponse } from "next/server";
import { formatTranscript, getAsset } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

export const runtime = "nodejs";

// Download an asset's transcript as a .txt — [m:ss] ~10s blocks when word-timed.
export async function GET(_req: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const viewer = await getViewer();
  const role = viewer?.identity?.role;
  const parishId = viewer?.identity?.parishId;
  if (!parishId || !isStaff(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const asset = await getAsset(parishId, assetId);
  if (!asset || !asset.transcriptText) return NextResponse.json({ error: "no transcript" }, { status: 404 });

  const body = formatTranscript(asset.transcriptText, asset.transcriptJson);
  const filename = `${asset.title.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "transcript"}.txt`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
