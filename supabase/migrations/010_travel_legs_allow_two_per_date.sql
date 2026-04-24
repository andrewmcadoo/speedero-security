-- Allow one Pick up AND one Drop off per date (previously only one leg total).
-- Swap UNIQUE(date) for UNIQUE(date, action).

alter table travel_legs drop constraint travel_legs_date_key;
alter table travel_legs add constraint travel_legs_date_action_unique unique (date, action);
