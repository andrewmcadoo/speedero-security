import { createClient } from "@/lib/supabase/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// basePath is not applied to absolute URLs built from `origin`, so we prefix manually.
// Keep in sync with next.config.ts `basePath`.
const BASE_PATH = "/SecApp";

/** Derive the public-facing origin from reverse-proxy headers. */
function getPublicOrigin(request: Request): string {
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const origin = getPublicOrigin(request);

  const next = searchParams.get("next");

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error) {
      const destination = next ?? (type === "recovery" ? "/reset-password" : "/dashboard");
      return NextResponse.redirect(`${origin}${BASE_PATH}${destination}`);
    }
  }

  return NextResponse.redirect(`${origin}${BASE_PATH}/login?error=auth`);
}
