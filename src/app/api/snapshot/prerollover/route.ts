import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAnchorDates } from "@/lib/schedule-utils";
import { runPreRolloverSnapshot } from "@/lib/snapshot/freeze";
import { checkCronAuth } from "@/lib/snapshot/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authResult = checkCronAuth(request);
  if (authResult === "not-configured") {
    return NextResponse.json(
      { error: "Snapshot endpoint not configured" },
      { status: 503 }
    );
  }
  if (authResult === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Service-role client: unattended cron with no user session. See run/route.ts.
    const supabase = createAdminClient();
    const { today } = getAnchorDates();
    const result = await runPreRolloverSnapshot(supabase, today);
    console.log(
      `[snapshot/prerollover] today=${today} snapshotted=${JSON.stringify(result.snapshotted)} unrecoverable=${JSON.stringify(result.unrecoverable)} already=${result.alreadyFrozen.length}`
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("[snapshot/prerollover] failed:", error);
    return NextResponse.json(
      { error: "Pre-rollover snapshot failed" },
      { status: 500 }
    );
  }
}
