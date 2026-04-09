-- Hotfix: Make handle_new_user trigger robust against null email
-- Run this in Supabase SQL Editor to fix the "Database error saving new user" issue

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, new.raw_user_meta_data->>'email', ''),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')
  );
  return new;
exception
  when others then
    raise log 'handle_new_user failed for %: %', new.id, sqlerrm;
    return new;
end;
$$ language plpgsql security definer;
