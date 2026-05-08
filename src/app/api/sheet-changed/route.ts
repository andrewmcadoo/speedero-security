import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { invalidateLiveSourcesCache } from "@/lib/snapshot/live-cache";
import { broadcastChanged } from "@/lib/sse/hub";
import { processSheetChange, verifyHmac } from "@/lib/sse/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const sig = req.headers.get("x-signature");
  const body = await req.text();
  if (!verifyHmac(body, sig, process.env.SHEET_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  processSheetChange({
    invalidate: invalidateLiveSourcesCache,
    broadcast: broadcastChanged,
  });
  return NextResponse.json({ ok: true });
}
