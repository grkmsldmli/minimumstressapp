-- PostgreSQL will not let the value be used safely by constraints, views, or
-- functions until the transaction that adds it commits. Keep this migration
-- intentionally single-purpose; the dependent objects live in the next one.
alter type public.notification_channel add value if not exists 'push';
