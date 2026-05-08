"use server";

import { createClient } from "@/lib/supabase/server";
import { assertNotPast, PastDateWriteError } from "@/lib/access-control";
import { invalidateLiveSourcesCache } from "@/lib/snapshot/live-cache";
import { broadcastChanged } from "@/lib/sse/hub";
import { revalidatePath } from "next/cache";
import type { DetailLevel } from "@/types/schedule";

export type ActionResult = { ok: true } | { ok: false; error: string };

// The supabase client returned by createClient() is intentionally typed as
// `unknown` here — the test factory returns a hand-rolled stub with just the
// methods we use. The real createClient() returns a SupabaseClient with the
// full surface; we narrow at the call sites.
type SupabaseLike = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    delete?: () => unknown;
    update?: (row: Record<string, unknown>) => unknown;
    upsert?: (row: Record<string, unknown>, opts?: unknown) => Promise<{ error: { message: string } | null }>;
  };
};

type SupabaseFactory = () => SupabaseLike | Promise<SupabaseLike>;

async function withGuard(
  dateStr: string,
  now: Date,
  fn: (supabase: SupabaseLike, userId: string) => Promise<ActionResult>,
  factory: SupabaseFactory
): Promise<ActionResult> {
  try {
    assertNotPast(dateStr, now);
  } catch (err) {
    if (err instanceof PastDateWriteError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
  const supabase = await factory();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  return fn(supabase, user.id);
}

// ---- assignEpo ----

export async function _assignEpoForTest(
  date: string,
  epoId: string,
  factory: SupabaseFactory,
  now: Date
): Promise<ActionResult> {
  return withGuard(date, now, async (supabase, userId) => {
    const { error } = await supabase.from("assignments").insert({
      date,
      epo_id: epoId,
      assigned_by: userId,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, factory);
}

export async function assignEpo(
  date: string,
  epoId: string
): Promise<ActionResult> {
  const result = await _assignEpoForTest(
    date,
    epoId,
    async () => (await createClient()) as unknown as SupabaseLike,
    new Date()
  );
  if (result.ok) {
    invalidateLiveSourcesCache();
    broadcastChanged();
    revalidatePath("/dashboard");
  }
  return result;
}

// ---- unassignEpo ----

export async function _unassignEpoForTest(
  date: string,
  epoId: string,
  factory: SupabaseFactory,
  now: Date
): Promise<ActionResult> {
  return withGuard(date, now, async (supabase) => {
    // The supabase delete chain returns a builder; the type stub is loose
    // because we only verify shape in tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = supabase.from("assignments").delete!();
    const { error } = await builder.eq("date", date).eq("epo_id", epoId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, factory);
}

export async function unassignEpo(
  date: string,
  epoId: string
): Promise<ActionResult> {
  const result = await _unassignEpoForTest(
    date,
    epoId,
    async () => (await createClient()) as unknown as SupabaseLike,
    new Date()
  );
  if (result.ok) {
    invalidateLiveSourcesCache();
    broadcastChanged();
    revalidatePath("/dashboard");
  }
  return result;
}

// ---- setDetailLevel ----

export async function _setDetailLevelForTest(
  date: string,
  level: DetailLevel,
  factory: SupabaseFactory,
  now: Date
): Promise<ActionResult> {
  return withGuard(date, now, async (supabase, userId) => {
    const { error } = await supabase.from("date_settings").upsert!({
      date,
      detail_level: level,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "date" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, factory);
}

export async function setDetailLevel(
  date: string,
  level: DetailLevel
): Promise<ActionResult> {
  const result = await _setDetailLevelForTest(
    date,
    level,
    async () => (await createClient()) as unknown as SupabaseLike,
    new Date()
  );
  if (result.ok) {
    invalidateLiveSourcesCache();
    broadcastChanged();
    revalidatePath("/dashboard");
  }
  return result;
}

// ---- travel-leg actions ----

type TravelAction = "Pick up" | "Drop off";

const TRAVEL_LEG_COLUMNS: Record<string, string> = {
  location: "location",
  time: "time",
  companion: "companion",
  companionPrePositionFlight: "companion_pre_position_flight",
  teakFlight: "teak_flight",
  companionReturnFlight: "companion_return_flight",
};

export async function _createTravelLegForTest(
  date: string,
  action: TravelAction,
  factory: SupabaseFactory,
  now: Date
): Promise<ActionResult> {
  return withGuard(date, now, async (supabase, userId) => {
    const { error } = await supabase.from("travel_legs").insert({
      date,
      action,
      created_by: userId,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, factory);
}

export async function createTravelLeg(
  date: string,
  action: TravelAction
): Promise<ActionResult> {
  const result = await _createTravelLegForTest(
    date,
    action,
    async () => (await createClient()) as unknown as SupabaseLike,
    new Date()
  );
  if (result.ok) {
    invalidateLiveSourcesCache();
    broadcastChanged();
    revalidatePath("/dashboard");
  }
  return result;
}

export type TravelLegFields = Partial<{
  location: string;
  time: string;
  companion: string;
  companionPrePositionFlight: string;
  teakFlight: string;
  companionReturnFlight: string;
}>;

export async function _updateTravelLegForTest(
  date: string,
  action: TravelAction,
  fields: TravelLegFields,
  factory: SupabaseFactory,
  now: Date
): Promise<ActionResult> {
  return withGuard(date, now, async (supabase) => {
    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    for (const [key, val] of Object.entries(fields)) {
      const col = TRAVEL_LEG_COLUMNS[key];
      if (col !== undefined && val !== undefined) payload[col] = val;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = supabase.from("travel_legs").update!(payload);
    const { error } = await builder.eq("date", date).eq("action", action);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, factory);
}

export async function updateTravelLeg(
  date: string,
  action: TravelAction,
  fields: TravelLegFields
): Promise<ActionResult> {
  const result = await _updateTravelLegForTest(
    date,
    action,
    fields,
    async () => (await createClient()) as unknown as SupabaseLike,
    new Date()
  );
  if (result.ok) {
    invalidateLiveSourcesCache();
    broadcastChanged();
    revalidatePath("/dashboard");
  }
  return result;
}

export async function _deleteTravelLegForTest(
  date: string,
  action: TravelAction,
  factory: SupabaseFactory,
  now: Date
): Promise<ActionResult> {
  return withGuard(date, now, async (supabase) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = supabase.from("travel_legs").delete!();
    const { error } = await builder.eq("date", date).eq("action", action);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, factory);
}

export async function deleteTravelLeg(
  date: string,
  action: TravelAction
): Promise<ActionResult> {
  const result = await _deleteTravelLegForTest(
    date,
    action,
    async () => (await createClient()) as unknown as SupabaseLike,
    new Date()
  );
  if (result.ok) {
    invalidateLiveSourcesCache();
    broadcastChanged();
    revalidatePath("/dashboard");
  }
  return result;
}
