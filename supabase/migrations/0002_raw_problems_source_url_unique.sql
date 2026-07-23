-- Lets the scraper upsert on source_url so re-running the cron doesn't
-- insert duplicate rows for posts already seen. Nulls are unaffected —
-- Postgres unique constraints allow multiple nulls.
alter table raw_problems
  add constraint raw_problems_source_url_key unique (source_url);
