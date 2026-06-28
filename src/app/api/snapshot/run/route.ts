import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAnchorDates } from "@/lib/schedule-utils";
import { runSnapshotForCron } from "@/lib/snapshot/freeze";

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
    // Service-role client: this is an unattended cron with no user session, so
    // the anon+cookie client would fail the is_management() RLS check on
    // card_snapshots inserts. Route is already gated by SNAPSHOT_CRON_TOKEN.
    const supabase = createAdminClient();
    const { today } = getAnchorDates();
    const result = await runSnapshotForCron(supabase, today);
    console.log(
      `[snapshot/run] today=${today} snapshotted=${JSON.stringify(result.snapshotted)} unrecoverable=${JSON.stringify(result.unrecoverable)} already=${result.alreadyFrozen.length}`
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("[snapshot/run] failed:", error);
    return NextResponse.json(
      { error: "Snapshot run failed", detail: String(error) },
      { status: 500 }
    );
  }
}
