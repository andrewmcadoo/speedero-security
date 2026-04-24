-- Teak Night is now read-only from the sheet (column D green background).
-- Drop the Supabase-backed column so the sheet value is authoritative.

alter table date_settings drop column teak_night;
