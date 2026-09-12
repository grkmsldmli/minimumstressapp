-- Cover the host foreign key used by ownership checks and host closure history.
create index if not exists listing_closure_requests_host_idx
  on listing_closure_requests (host_id);
