-- Move the sublease-proof requirement from "every row" to "every live listing".
--
-- sublease_doc_path was not-null, which reads like the right guarantee and is
-- not enforceable in the order the work actually happens. Storage policies for
-- the verification-docs bucket ask whether the first path segment is a space
-- this host owns, so a file cannot be uploaded until the space row exists —
-- and the row could not be inserted without the path. The only ways out were
-- to store a filename that pointed at nothing, which is what the app did and
-- left every listing unreviewable, or to write a placeholder, which is a lie
-- in a column that exists to prevent one.
--
-- The invariant worth keeping is not "no row without a document". It is "no
-- listing takes bookings without proof the host may sublet". That is what this
-- says, and it says it about exactly the moment it matters.

alter table spaces alter column sublease_doc_path drop not null;

do $$
begin
  alter table spaces add constraint spaces_active_needs_sublease_proof
    check (status <> 'active' or sublease_doc_path is not null);
exception
  when duplicate_object then null;
end $$;

-- Nothing existing can violate it: status defaults to 'pending' and only staff
-- move a listing to 'active', which is the review this constraint backs up.
