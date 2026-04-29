import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnchorDates } from "@/lib/schedule-utils";
import { runPreRolloverSnapshot } from "@/lib/snapshot/freeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = process.env.SNAPSHOT_CRON_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Snapshot endpoint not configured" },
      { status: 503 }
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = await createClient();
    const { today } = getAnchorDates();
    const result = await runPreRolloverSnapshot(supabase, today);
    console.log(
      `[snapshot/prerollover] today=${today} snapshotted=${JSON.stringify(result.snapshotted)} unrecoverable=${JSON.stringify(result.unrecoverable)} already=${result.alreadyFrozen.length}`
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("[snapshot/prerollover] failed:", error);
    return NextResponse.json(
      { error: "Pre-rollover snapshot failed", detail: String(error) },
      { status: 500 }
    );
  }
}
