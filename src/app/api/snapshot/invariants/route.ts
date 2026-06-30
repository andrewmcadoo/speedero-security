import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAnchorDates } from "@/lib/schedule-utils";
import {
  getMirrorDatesBefore,
  getSnapshotDatesBefore,
} from "@/lib/supabase/queries";
import { selectMissingSnapshots } from "@/lib/snapshot/invariants";
import { buildInvariantAlertEmail } from "@/lib/email/invariant-alert";
import { sendEmail } from "@/lib/email/resend";
import { checkCronAuth } from "@/lib/snapshot/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = checkCronAuth(request);
  if (auth === "not-configured") {
    return NextResponse.json(
      { error: "Invariant check not configured" },
      { status: 503 }
    );
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const { today } = getAnchorDates();
    const [mirrorDates, snapshotDates] = await Promise.all([
      getMirrorDatesBefore(supabase, today),
      getSnapshotDatesBefore(supabase, today),
    ]);
    const missing = selectMissingSnapshots(mirrorDates, new Set(snapshotDates));
    console.log(
      `[snapshot/invariants] today=${today} mirrorPast=${mirrorDates.length} snapshots=${snapshotDates.length} missing=${JSON.stringify(missing)}`
    );

    if (missing.length > 0) {
      console.error(`[snapshot/invariants] CAPTURE GAP: ${missing.join(", ")}`);
      const alertTo = process.env.SNAPSHOT_ALERT_EMAIL;
      if (alertTo) {
        try {
          await sendEmail({
            to: alertTo,
            ...buildInvariantAlertEmail({ missing }),
          });
        } catch (e) {
          console.error("[snapshot/invariants] failed to send alert:", e);
        }
      }
    }
    return NextResponse.json({ missingCount: missing.length, missing });
  } catch (error) {
    console.error("[snapshot/invariants] failed:", error);
    return NextResponse.json(
      { error: "Invariant check failed" },
      { status: 500 }
    );
  }
}
