# What we hold, why, and for how long

Written because holding somebody's lease is not the same as holding their
email address, and the difference should be stated rather than assumed.

**This is not legal advice and I am not a lawyer.** It is an engineer's account
of what the system actually does, so that a lawyer reviewing it is reading
facts rather than intentions. The last section lists what still needs one.

## What is collected

| | Why | Who can read it |
|---|---|---|
| Email | Sign-in, and every transactional message | The account holder; staff |
| Display name | Shown to the other side of a booking | Anyone, once a listing is live |
| Sublease proof | Confirming a host may legally sublet the room | The host; staff |
| Space insurance certificate | Optional, offered by hosts who have one | The host; staff |
| Practitioner insurance certificate | Optional; some hosts require it | The practitioner; staff |
| Street address and coordinates | Getting a practitioner to the door | The host; a practitioner **after** booking |
| Emergency contact | Reaching somebody if a session goes wrong | The account holder; staff |
| Phone | Door-code texts, only if given and opted in | The account holder; staff |
| Card details | — | **Nobody here.** Stripe holds them; we never see a number |

A sublease document is the most sensitive item on that list. It typically
carries a home address, a landlord's name and a signature — more than the app
otherwise knows about anyone.

## Where documents live

Supabase Storage, bucket `verification-docs`, private. Not "private" as a
setting somebody remembers to check: `scripts/audit-documents.mjs` uploads a
canary and then attacks it the way an attacker would — the public URL, the
publishable key that ships in every browser bundle, minting a signed URL
without permission, guessing a path, listing the bucket anonymously. Every one
is refused, and the script runs against production.

Filenames are generated, never taken from the upload. The path decides which
row-level policy applies, so a file called `../another-space/lease.pdf` would
have moved a document into somebody else's folder with the policy's blessing.
Nothing the uploader typed reaches the path, and the extension comes from the
validated content type.

Photos of rooms are in a separate, public bucket. That split is by sensitivity
rather than by feature, because it is what the access rule actually depends on.

## How long it is kept

| | Kept | Then |
|---|---|---|
| Verification documents | While the listing is active, plus 12 months | Deleted |
| Bookings and their money | 7 years | Kept — tax records |
| Messages about a booking | 2 years after the session | Deleted |
| Reviews | While the account exists | Anonymised, not deleted |
| Emergency contact | While the account exists | Deleted with the account |
| Access codes | 30 days after the session | Deleted |

The seven years on bookings is the outlier and the reason it is not "delete
everything on request": a completed booking is a financial record for both
sides, and deleting it would take a host's own income history with it. What is
removed on request is everything that identifies the person; what remains is
the transaction.

Reviews are anonymised rather than deleted for the same reason from the other
direction — a listing's rating is partly other people's contribution, and
removing one account should not rewrite what everybody else said.

## Deleting an account

`/api/account/delete` does it, and does it in an order chosen so a failure
halfway leaves nothing dangerous behind:

1. Documents are removed from storage first. They are the sensitive part, and
   a half-finished deletion that has removed the row but kept the file is the
   worst possible outcome.
2. Personal fields are cleared from the profile — name, phone, emergency
   contact, address.
3. Reviews are detached from the author.
4. Bookings keep their money and lose their person.
5. The auth user is deleted last, because until it is gone the account can
   still be used to ask what happened.

A request is refused while a session is still upcoming. Deleting an account
with a room booked for tomorrow leaves a host expecting somebody who no longer
exists, and a practitioner with a door code and no way to ask about it.

## Who can look at a document

Staff, through the Supabase dashboard with the service role. There is no
in-app admin panel — the brief calls that out as deliberate rather than
missing, and it means document review happens in a place with its own audit
log rather than behind a screen we would have to secure ourselves.

No client policy grants read access to anyone but the uploader. A practitioner
never sees a host's lease; a host never sees a practitioner's insurance
certificate; neither ever sees the other's emergency contact.

## What still needs a lawyer

Listed plainly rather than buried, because each one is a real question that
engineering cannot answer:

- **Terms of Service and Privacy Policy as published documents.** The Legal
  screen states the rules the software enforces. That is not the same as a
  contract, and the gap matters most on the point the brief is most careful
  about: that practitioners license space and are not engaged, which is an
  AB5 question in California.
- **Whether holding sublease documents creates any duty to verify them.** We
  collect proof that a host may sublet. Collecting it is not the same as
  vouching for it, and where that line sits is not an engineering question.
- **Data residency.** Supabase and Resend are both in `us-east-1`. If anyone
  in the EU or UK signs up, that is a transfer, and the answer involves
  paperwork rather than code.
- **Retention periods.** The seven years above follows ordinary US practice
  for financial records. It should be confirmed rather than inherited from a
  habit.
- **Insurance requirements.** The app lets a host require a certificate and
  lets a practitioner upload one. Whether that satisfies anything, and what
  the marketplace's own position is when it does not, is a question for a
  broker and a lawyer.
- **What the platform owes when a session goes wrong.** The Legal screen says
  we are not a party to the booking. That is the intended position; whether it
  holds is not something the code can establish.
