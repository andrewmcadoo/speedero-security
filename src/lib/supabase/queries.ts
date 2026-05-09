import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardSnapshot, DashboardEntry, Profile } from "@/types/schedule";
import type {
  Sop,
  SopAudience,
  SopAuditLogEntryWithActor,
} from "@/types/sops";

interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  role: "epo" | "management";
  created_at: string;
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name ?? "",
    role: row.role,
    createdAt: row.created_at,
  };
}

export async function getProfile(
  supabase: SupabaseClient
): Promise<Profile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (data) return toProfile(data as ProfileRow);

  // Profile row missing (trigger may have failed on first login).
  // Create it now as a fallback.
  const { data: newProfile } = await supabase
    .from("profiles")
    .upsert({
      id: user.id,
      email: user.email ?? user.user_metadata?.email ?? "",
      full_name:
        user.user_metadata?.full_name ?? user.user_metadata?.name ?? "",
      role: "epo",
    })
    .select()
    .single();

  return newProfile ? toProfile(newProfile as ProfileRow) : null;
}

export async function getAssignmentsForUser(
  supabase: SupabaseClient,
  userId: string
) {
  const { data } = await supabase
    .from("assignments")
    .select("*")
    .eq("epo_id", userId);
  return data ?? [];
}

export async function getAllAssignmentsWithProfiles(
  supabase: SupabaseClient
) {
  const { data } = await supabase
    .from("assignments")
    .select("*, profiles:epo_id(id, full_name, email)");
  return data ?? [];
}

export async function getDateSettings(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("date_settings")
    .select("date, detail_level");
  if (error) {
    console.error("getDateSettings failed:", error.message, error.code, error.details, error.hint);
    return [];
  }
  return data ?? [];
}

export async function getAllEpos(
  supabase: SupabaseClient,
  includeSelfId?: string
) {
  // Returns all EPOs, plus the given profile id if provided. This lets a
  // management user self-assign without exposing other managers in the
  // assignment dropdown.
  const filter = includeSelfId
    ? `role.eq.epo,id.eq.${includeSelfId}`
    : `role.eq.epo`;
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .or(filter)
    .order("full_name");
  return data ?? [];
}

export async function getTravelLegs(supabase: SupabaseClient) {
  const { data } = await supabase.from("travel_legs").select("*");
  return data ?? [];
}

interface CardSnapshotRow {
  date: string;
  payload: DashboardEntry;
  frozen_at: string;
  frozen_by: "cron" | "lazy" | "manual";
}

function toCardSnapshot(row: CardSnapshotRow): CardSnapshot {
  return {
    date: row.date,
    payload: row.payload,
    frozenAt: row.frozen_at,
    frozenBy: row.frozen_by,
  };
}

/**
 * Returns the set of dates (within the input list) that already have a
 * snapshot row. Used by both the cron and the lazy backfill to skip
 * already-frozen dates.
 */
export async function getSnapshotDates(
  supabase: SupabaseClient,
  dates: string[]
): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const { data, error } = await supabase
    .from("card_snapshots")
    .select("date")
    .in("date", dates);
  if (error) {
    console.error("getSnapshotDates failed:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r: { date: string }) => r.date));
}

/**
 * Returns all snapshots whose date is in [start, end] inclusive, ordered
 * by date ascending.
 */
export async function getSnapshotsBetween(
  supabase: SupabaseClient,
  start: string,
  end: string
): Promise<CardSnapshot[]> {
  const { data, error } = await supabase
    .from("card_snapshots")
    .select("date, payload, frozen_at, frozen_by")
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });
  if (error) {
    console.error("getSnapshotsBetween failed:", error.message);
    return [];
  }
  return (data ?? []).map((row) => toCardSnapshot(row as CardSnapshotRow));
}

/**
 * Insert a snapshot. Never overwrites — if a snapshot for `date` already
 * exists, this is a no-op (returns false). Returns true on insert.
 */
export async function upsertSnapshot(
  supabase: SupabaseClient,
  args: { date: string; payload: DashboardEntry; frozenBy: "cron" | "lazy" | "manual" }
): Promise<boolean> {
  const { error } = await supabase
    .from("card_snapshots")
    .insert({
      date: args.date,
      payload: args.payload,
      frozen_by: args.frozenBy,
    });
  if (error) {
    // Unique-constraint violation = "already snapshotted" = expected.
    if (error.code === "23505") return false;
    console.error("upsertSnapshot failed:", error.message, error.code);
    return false;
  }
  return true;
}

// ---- SOPs ----

interface SopRow {
  id: string;
  title: string;
  description: string | null;
  audience: SopAudience;
  storage_path_pdf: string;
  storage_path_original: string;
  original_filename: string;
  original_mime_type: string;
  file_size_bytes: number;
  uploaded_by: string;
  uploaded_at: string;
  updated_at: string;
}

function toSop(row: SopRow): Sop {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    audience: row.audience,
    storagePathPdf: row.storage_path_pdf,
    storagePathOriginal: row.storage_path_original,
    originalFilename: row.original_filename,
    originalMimeType: row.original_mime_type,
    fileSizeBytes: row.file_size_bytes,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Returns SOPs visible to the caller's session — RLS handles the audience
 * filter. EPO sessions get only `shared` rows; management gets everything.
 */
export async function getSops(supabase: SupabaseClient): Promise<Sop[]> {
  const { data, error } = await supabase
    .from("sops")
    .select("*")
    .order("uploaded_at", { ascending: false });
  if (error) {
    console.error("getSops failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => toSop(r as SopRow));
}

export async function getSopById(
  supabase: SupabaseClient,
  id: string
): Promise<Sop | null> {
  const { data, error } = await supabase
    .from("sops")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("getSopById failed:", error.message);
    return null;
  }
  return data ? toSop(data as SopRow) : null;
}

// ---- SOP audit log ----

interface AuditRow {
  id: string;
  occurred_at: string;
  actor_id: string;
  sop_id: string;
  action: SopAuditLogEntryWithActor["action"];
  title_at_action: string;
  audience_at_action: SopAudience;
  new_storage_path: string | null;
  new_filename: string | null;
  new_mime_type: string | null;
  new_file_size_bytes: number | null;
  superseded_storage_path: string | null;
  superseded_filename: string | null;
  prev_title: string | null;
  prev_description: string | null;
  next_description: string | null;
  prev_audience: SopAudience | null;
  actor: { full_name: string | null; email: string } | null;
}

function toAudit(row: AuditRow): SopAuditLogEntryWithActor {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorId: row.actor_id,
    sopId: row.sop_id,
    action: row.action,
    titleAtAction: row.title_at_action,
    audienceAtAction: row.audience_at_action,
    newStoragePath: row.new_storage_path,
    newFilename: row.new_filename,
    newMimeType: row.new_mime_type,
    newFileSizeBytes: row.new_file_size_bytes,
    supersededStoragePath: row.superseded_storage_path,
    supersededFilename: row.superseded_filename,
    prevTitle: row.prev_title,
    prevDescription: row.prev_description,
    nextDescription: row.next_description,
    prevAudience: row.prev_audience,
    actorFullName: row.actor?.full_name ?? "",
    actorEmail: row.actor?.email ?? "",
  };
}

export interface AuditFilters {
  sopId?: string;
  actorId?: string;
  actions?: SopAuditLogEntryWithActor["action"][];
  titleQuery?: string;
  startDate?: string; // YYYY-MM-DD inclusive
  endDate?: string;   // YYYY-MM-DD inclusive
  limit?: number;
  offset?: number;
}

export async function getSopAuditLog(
  supabase: SupabaseClient,
  filters: AuditFilters = {}
): Promise<{ entries: SopAuditLogEntryWithActor[]; totalCount: number }> {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  let query = supabase
    .from("sop_audit_log")
    .select(
      "*, actor:actor_id(full_name, email)",
      { count: "exact" }
    )
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.sopId) query = query.eq("sop_id", filters.sopId);
  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters.actions && filters.actions.length > 0) {
    query = query.in("action", filters.actions);
  }
  if (filters.titleQuery) {
    // pg_trgm-backed substring match (% is the SQL LIKE wildcard)
    query = query.ilike("title_at_action", `%${filters.titleQuery}%`);
  }
  if (filters.startDate) {
    query = query.gte("occurred_at", `${filters.startDate}T00:00:00Z`);
  }
  if (filters.endDate) {
    query = query.lte("occurred_at", `${filters.endDate}T23:59:59Z`);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("getSopAuditLog failed:", error.message);
    return { entries: [], totalCount: 0 };
  }
  return {
    entries: (data ?? []).map((r) => toAudit(r as AuditRow)),
    totalCount: count ?? 0,
  };
}

export async function listManagementProfiles(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "management")
    .order("full_name");
  if (error) {
    console.error("listManagementProfiles failed:", error.message);
    return [];
  }
  return data ?? [];
}
