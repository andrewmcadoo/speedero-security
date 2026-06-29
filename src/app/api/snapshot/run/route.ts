import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAnchorDates } from "@/lib/schedule-utils";
import { runMirrorReconcile, assessCaptureHealth } from "@/lib/snapshot/freeze";
import { buildCaptureAlertEmail } from "@/lib/email/capture-alert";
import { sendEmail } from "@/lib/email/resend";

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
    // Service-role client: unattended cron with no user session. See prerollover.
    const supabase = createAdminClient();
    const { today } = getAnchorDates();
    // Full-range reconciler: freeze every past date the mirror/live sheet has but
    // card_snapshots lacks — not just a fixed 7-day window.
    const result = await runMirrorReconcile(supabase, today);
    console.log(
      `[snapshot/run] today=${today} snapshotted=${JSON.stringify(result.snapshotted)} unrecoverable=${JSON.stringify(result.unrecoverable)} already=${result.alreadyFrozen.length} liveRows=${result.liveScheduleCount}`
    );

    // Observability: alert if capture looks broken. Always log; email when an
    // alert recipient is configured (SNAPSHOT_ALERT_EMAIL).
    const issues = assessCaptureHealth({
      liveScheduleCount: result.liveScheduleCount ?? 0,
      unrecoverable: result.unrecoverable,
    });
    if (issues.length > 0) {
      console.error(`[snapshot/run] CAPTURE HEALTH: ${issues.join(" | ")}`);
      const alertTo = process.env.SNAPSHOT_ALERT_EMAIL;
      if (alertTo) {
        try {
          await sendEmail({
            to: alertTo,
            ...buildCaptureAlertEmail({ today, issues }),
          });
        } catch (e) {
          console.error("[snapshot/run] failed to send capture alert:", e);
        }
      }
    }
    return NextResponse.json({ ...result, issues });
  } catch (error) {
    console.error("[snapshot/run] failed:", error);
    return NextResponse.json(
      { error: "Snapshot run failed", detail: String(error) },
      { status: 500 }
    );
  }
}
