-- Cover the two non-primary foreign keys on the durable message job table.
-- This keeps profile/booking cascades from scanning the full retry queue as it
-- grows; the due-work partial index remains dedicated to worker claims.

create index if not exists message_notification_jobs_booking_idx
  on public.message_notification_jobs(booking_id);

create index if not exists message_notification_jobs_sender_idx
  on public.message_notification_jobs(sender_id);
