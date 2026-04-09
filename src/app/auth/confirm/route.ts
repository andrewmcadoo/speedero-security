import { createClient } from "@/lib/supabase/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// basePath is not applied to absolute URLs built from `origin`, so we prefix manually.
// Keep in sync with next.config.ts `basePath`.
const BASE_PATH = "/SecApp";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error) {
      return NextResponse.redirect(`${origin}${BASE_PATH}/dashboard`);
    }
  }

  return NextResponse.redirect(`${origin}${BASE_PATH}/login?error=auth`);
}
