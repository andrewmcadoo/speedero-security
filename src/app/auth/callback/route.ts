import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// basePath is not applied to absolute URLs built from `origin`, so we prefix manually.
// Keep in sync with next.config.ts `basePath`.
const BASE_PATH = "/SecApp";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${BASE_PATH}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}${BASE_PATH}/login?error=auth`);
}
