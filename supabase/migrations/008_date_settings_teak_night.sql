-- Add manager-controlled teak_night flag to date_settings.
-- Replaces the Google Sheets green-cell-background derivation.
alter table date_settings
  add column teak_night boolean not null default false;
