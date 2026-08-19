# Request for counsel — marketplace terms review

**To:** [Firm / attorney name]
**From:** [Your name], Minimum Stress Consulting Services LLC
**Date:** [Date]
**Re:** Drafting protective clauses and reviewing existing terms for a two-sided marketplace launching in California

---

## 1. What we are

Minimum Stress Consulting Services LLC, a California LLC, operates **Minimum Stress** (minimumstress.app), a marketplace where wellness practitioners rent private rooms by the hour from the people who own them.

- **Hosts** are studio, treatment-room and office owners with hours they are not using.
- **Practitioners** are yoga teachers, coaches, therapists and similar independent professionals who see their own clients.
- Practitioners bring their own clients to the session. Those clients are not our users and have no account with us.

We are launching in the San Francisco Bay Area. Live today with a small number of listings.

## 2. How money moves

- The host sets an hourly rate and receives **100%** of it.
- We add a **20% service fee** on top, charged to the practitioner. The advertised price is all-in — the fee is included in every price shown, in line with SB 478.
- Payment is taken at the time of booking through **Stripe** (Stripe Connect). We never hold card details.
- Funds are held and released to the host approximately **two business days after the session**.
- **Cancellation:** 24 hours or more before the session, the practitioner is refunded everything except the card network's processing fee (roughly $1.87 on a $54 booking), which the network retains regardless. Inside 24 hours, the full amount is captured. If the host cancels, the practitioner is refunded in full including that fee.
- A paid subscription ("Pro", $9.90/month) removes booking limits and returns the processing fee on early cancellation.
- A saved card may be charged again only for damage, extra cleaning or overrun, and only after a dispute process. This is disclosed at checkout where Stripe records the card-on-file mandate.

## 3. What we do and do not do

**We do:**
- Take payment, hold it, and pay the host.
- Review a host's proof that they may sublicense their space, and their insurance certificate if provided.
- Release the room's entry instructions and access code to the practitioner shortly before the session.
- Operate a refund and damage-claim process in which a member of staff reads both accounts and decides an outcome.
- Allow a host to require their approval before a booking completes. Where they do, we authorise the practitioner's card and hold it — taking the money only if the host accepts, and releasing it if they decline or do not answer within a day.
- Record safety reports and escalate them to a person.

**We do not:**
- Own, lease or control any of the spaces.
- Provide any medical, therapeutic or health service.
- Verify a practitioner's qualifications, training or fitness to practise.
- Take part in the session itself, or in the practitioner's relationship with their own client.

## 4. What we already have

Our terms and privacy policy are published at minimumstress.app/terms and /privacy and are shown in the app before anyone can use it. Both sides must accept before doing anything, and acceptance is recorded with a version number and a server-set timestamp. Hosts additionally acknowledge, per listing, that they hold the legal right to sublicense that space for paid sessions.

The existing text covers: the marketplace relationship, independent-contractor status, the off-platform booking prohibition, health and wellness disclaimers, cancellation and refund policy, reviews and safety, and a privacy policy naming every third-party processor.

We have since drafted a separate **Host Terms** (published at /host-terms), accepted once by a host before their first listing, on its own version line and its own timestamp — independent of the general Terms above. It is drafted but **not reviewed by counsel**; section 7 sets out what is in it and the specific points we are unsure of.

## 5. What we are asking you to draft

Our current terms contain **none** of the following. These are what we would like drafted:

1. **Binding arbitration clause and class action waiver** — enforceable in California, with whatever opt-out and cost-allocation provisions are required for it to survive an unconscionability challenge.
2. **Limitation of liability** — a cap, drafted with California Civil Code §1668 in mind. We understand we cannot disclaim liability for our own fraud, wilful injury or violation of law, and we are not asking you to try.
3. **Indemnification** — users indemnifying us for claims arising from their own conduct, their own clients, and their own compliance obligations.
4. **Governing law and venue.**
5. **Warranty disclaimer** — the platform provided "as is", with the health and wellness disclaimers we already have folded in properly.

## 6. What we are asking you to review

1. **Worker classification.** Our terms deliberately describe a practitioner as *licensing a room by the hour* and as our customer, never as engaged, hired, or providing services to us. We drafted this with the AB5 ABC test in mind. Please tell us whether the language holds and where it does not.
2. **Retention of the processing fee on cancellation.** We retain only the actual amount the card network keeps, we add nothing to it, and it is disclosed before payment. Please confirm this is defensible, and tell us how it must be described.
3. **Privacy policy against CCPA/CPRA.** It names every processor, states retention, and lists the rights. Please tell us what is missing and whether we meet the thresholds that trigger the fuller obligations.
4. **Whether we can say we are not a party to the booking.** Our terms currently state: *"Minimum Stress runs a marketplace. We are not a party to the room booking itself, nor to the session a practitioner runs with their own client."* We are raising this against ourselves because the second half looks defensible to us and the first half may not.

   What we actually do to a booking: we set and collect the total, we hold the money until after the session and then pay the host, we set the service fee, we decide whether a booking may be made at all, we generate the access code and control when it is released, we can cancel a booking, and we decide refund and damage-claim outcomes ourselves. A host can also require our approval before a booking completes, and where they do we hold the practitioner's card and only take the money if the host accepts.

   Please tell us whether "not a party to the booking" survives that, what we would have to stop doing for it to be true, or how the clause should be redrafted so that it claims only what is defensible. We would rather carry an accurate description of our role than an over-broad disclaimer that fails as a whole when it is tested.

5. **Anything a marketplace of this shape ordinarily needs that we have not thought of.** Our particular concern is physical risk: a practitioner and their client are alone in a room belonging to a third party, arranged through us.

## 7. Host Terms — a second agreement, drafted and awaiting your review

We drafted a separate Host Terms because listing a space carries obligations a booking guest never takes on, and folding them into the terms everyone accepts would both over-burden guests and leave a host's acceptance of them unprovable. A host accepts these once, before their first listing; acceptance is versioned and timestamped like the general terms, the version is set server-side (a host cannot record a version they were not shown), and a listing cannot be published until it is accepted. The full text is at /host-terms.

The document was written from what the product actually does — the payout model, the claim window, the review step and the account-suspension powers were each traced to code before they were written down. The points below are where the wording turns on a legal judgement rather than a product fact, and where we want your view. They are marked in the source as `REVIEW` at `src/lib/host-terms.ts`.

1. **The whole document.** It has not been reviewed by counsel and should not ship as final until it has. Everything below is a specific worry inside that general one.

2. **"You are an independent operator" (and the platform-role question in 6.4).** The Host Terms deliberately state only that a host is an independent business operating their own space, and deliberately **do not** repeat the general terms' "not a party to the booking" language, because that broader disclaimer is exactly what we have flagged against ourselves in 6.4. Please tell us whether the narrower host-facing wording is right, and keep it consistent with however 6.4 resolves.

3. **Anti-circumvention, restated for hosts.** The Host Terms tell a host they may not take a confirmed booking off-platform, resell it, or arrange outside payment — the same prohibition the general terms already place on everyone. Please confirm the two are consistent and enforceable together, and that restating it against hosts does not weaken it.

4. **Cancellations and standing.** The Host Terms say repeated late cancellations can pause a host's ability to take bookings. This describes the reliability model the app actually enforces (a 90-day window, a threshold, a temporary pause). Please confirm the consequence is stated no more strongly than the system imposes.

5. **Damage and claims.** The Host Terms say a host may report damage within the in-app window and that the outcome depends on the evidence and on what the payment system supports. The app authorises the guest's card at booking, and that authorisation is what a claim can draw on. We have deliberately not asserted any broader recovery power. Please confirm the wording matches the card-on-file mandate and claim process in place (this is the host-side of the same fact as 2, para 28).

6. **Insurance.** The Host Terms place property and business insurance on the host, state that we provide none, and say some uses "may carry their own insurance requirements, which are shown where they apply." Whether client-facing or professional bookings should carry a separate liability-insurance requirement is a product-and-legal decision we have not made or built. Please advise whether we should.

## 8. What we would like from you

- A quote and estimated turnaround for the drafting in section 5.
- A separate quote for the review in section 6, if you would rather scope them apart.
- Your view on whether anything here should stop us taking bookings from members of the public before it is in place.

We have working drafts of some clauses that we are happy to send if reviewing a draft is cheaper than drafting from scratch. We would rather you tell us they are wrong than not see them.

---

**Contact:** [your email] · [your phone]
**The app:** https://minimumstress.app · terms at /terms · privacy at /privacy
