import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronHeartbeat } from "@/lib/supabase/queries";
import {
  assessHeartbeatStaleness,
  WATCHDOG_MAX_AGE_HOURS,
  SNAPSHOT_RUN_HEARTBEAT,
} from "@/lib/snapshot/heartbeat";
import { buildWatchdogAlertEmail } from "@/lib/email/watchdog-alert";
import { sendEmail } from "@/lib/email/resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = process.env.SNAPSHOT_CRON_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Watchdog not configured" },
      { status: 503 }
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const lastSuccessAt = await getCronHeartbeat(
      supabase,
      SNAPSHOT_RUN_HEARTBEAT
    );
    const { stale, ageHours } = assessHeartbeatStaleness({
      lastSuccessAt,
      now: new Date(),
      thresholdHours: WATCHDOG_MAX_AGE_HOURS,
    });
    if (stale) {
      console.error(
        `[snapshot/watchdog] STALE lastSuccessAt=${lastSuccessAt} ageHours=${ageHours}`
      );
      const alertTo = process.env.SNAPSHOT_ALERT_EMAIL;
      if (alertTo) {
        try {
          await sendEmail({
            to: alertTo,
            ...buildWatchdogAlertEmail({ lastSuccessAt, ageHours }),
          });
        } catch (e) {
          console.error("[snapshot/watchdog] failed to send alert:", e);
        }
      }
    }
    return NextResponse.json({ stale, lastSuccessAt, ageHours });
  } catch (error) {
    console.error("[snapshot/watchdog] failed:", error);
    return NextResponse.json(
      { error: "Watchdog failed", detail: String(error) },
      { status: 500 }
    );
  }
}
