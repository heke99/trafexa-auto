begin;
-- NOT VALID preserves legacy rows for explicit review. New inserts/updates,
-- including old supported RPCs, must use the same make/model limits as the UI.
alter table public.vehicles add constraint vehicles_make_contract check(length(make) between 1 and 160) not valid;
alter table public.vehicles add constraint vehicles_model_contract check(length(model) between 1 and 160) not valid;
commit;
