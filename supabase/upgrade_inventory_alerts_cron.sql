-- Daily Slack digest of expiring/low-stock chemicals ------------------------
--
-- This wires up a scheduled call to the `inventory-alerts` Edge Function
-- (supabase/functions/inventory-alerts) using pg_cron + pg_net, both of
-- which are available on every Supabase project (Database -> Extensions).
--
-- Before running this file:
--   1. Deploy the function:      supabase functions deploy inventory-alerts
--   2. Set its secrets:          supabase secrets set \
--                                  SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
--      (SUPABASE_URL and the service role key are already available to every
--      Edge Function automatically — nothing else to set.)
--   3. Replace <PROJECT_REF> below with your project's ref (the subdomain in
--      your Supabase URL, e.g. abcdefghijklmnop) and <SERVICE_ROLE_KEY> with
--      the project's service_role key (Project Settings -> API Keys) —
--      this file is a local template, not meant to be committed with real
--      values filled in.
--
-- The function checks that the caller's bearer token equals the service role
-- key, so only this scheduled job (or someone who already has that key) can
-- trigger it.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'pearl-inventory-alerts-daily',
  '0 1 * * *', -- 01:00 UTC daily — adjust to your lab's timezone/working hours
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/inventory-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To remove the schedule later:
-- select cron.unschedule('pearl-inventory-alerts-daily');
