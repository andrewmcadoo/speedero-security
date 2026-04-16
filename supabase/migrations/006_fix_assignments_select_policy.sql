-- Allow all authenticated users to read assignments (EPOs need to see
-- co-assigned EPOs on shared dates, not just their own rows).
drop policy "EPOs can read own assignments" on assignments;

create policy "Authenticated users can read assignments"
  on assignments for select
  using (auth.uid() is not null);
