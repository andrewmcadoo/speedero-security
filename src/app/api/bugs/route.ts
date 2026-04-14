import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DESCRIPTION_MAX, formatIssue } from "@/lib/bugs/format-issue";
import { createRateLimiter } from "@/lib/bugs/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = "andrewmcadoo/speedero-security";
const GITHUB_API = `https://api.github.com/repos/${REPO}/issues`;
const GITHUB_TIMEOUT_MS = 10_000;

// Module-scoped so it persists across requests in the same server instance.
// Note: on serverless (Vercel), each warm instance has its own limiter, so
// a burst across N instances can allow up to N*max reports. For 5/hour/user
// this is an acceptable soft cap, not a security boundary.
const limiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id || !user.email) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const description =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).description
      : undefined;

  if (typeof description !== "string" || description.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "Description is required" },
      { status: 400 }
    );
  }

  if (description.length > DESCRIPTION_MAX) {
    return NextResponse.json(
      { ok: false, error: `Description must be ${DESCRIPTION_MAX} characters or fewer` },
      { status: 400 }
    );
  }

  const token = process.env.GITHUB_BUGS_TOKEN;
  if (!token) {
    console.error("GITHUB_BUGS_TOKEN is not set");
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 }
    );
  }

  // Rate-limit by stable user id (email can change).
  const rate = limiter.check(user.id);
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many reports. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rate.retryAfterMs / 1000).toString() },
      }
    );
  }

  const issue = formatIssue({
    description,
    email: user.email,
    // `referer` is best-effort diagnostic info — it can be absent or spoofed.
    url: request.headers.get("referer") ?? "(unknown)",
    timestamp: new Date().toISOString(),
    userAgent: request.headers.get("user-agent") ?? "(unknown)",
  });

  let githubResponse: Response;
  try {
    githubResponse = await fetch(GITHUB_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "speedero-security-bug-reporter",
      },
      body: JSON.stringify({
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
      }),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
  } catch (error) {
    limiter.rollback(user.id);
    console.error("GitHub issue request failed", error);
    return NextResponse.json(
      { ok: false, error: "Could not file the report" },
      { status: 504 }
    );
  }

  if (!githubResponse.ok) {
    limiter.rollback(user.id);
    const text = await githubResponse.text().catch(() => "");
    console.error("GitHub issue creation failed", githubResponse.status, text);
    return NextResponse.json(
      { ok: false, error: "Could not file the report" },
      { status: 502 }
    );
  }

  const created = (await githubResponse.json().catch(() => ({}))) as { number?: number };
  console.info("bug filed", { userId: user.id, issue: created.number });

  return NextResponse.json({ ok: true });
}
