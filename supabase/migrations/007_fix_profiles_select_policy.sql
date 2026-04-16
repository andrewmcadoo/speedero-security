-- Allow all authenticated users to read profiles (EPOs need to see
-- co-assigned EPO names via the assignments join).
drop policy "Users can read own profile" on profiles;

create policy "Authenticated users can read profiles"
  on profiles for select
  using (auth.uid() is not null);
