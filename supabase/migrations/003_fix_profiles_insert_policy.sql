-- Hotfix: Allow authenticated users to insert their own profile row.
-- This is needed because the handle_new_user trigger may have failed
-- on first login, and the fallback upsert in getProfile needs INSERT permission.
-- Run this in Supabase SQL Editor.

create policy "Users can insert own profile"
  on profiles for insert
  with check (id = auth.uid());
