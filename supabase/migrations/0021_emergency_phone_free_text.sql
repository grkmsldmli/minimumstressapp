-- An emergency contact number is whatever the person wrote down.
--
-- The column insisted on E.164: a leading plus, a country code, no spaces.
-- The reasoning was that a number nobody can dial is no use in a hurry, which
-- is true and led to the wrong rule. What it produced was a field that
-- rejected "0533 395 5823", "(415) 555-0134" and "555 0134 ext. 2" — every
-- one of which a person on our team could dial, and every one of which is how
-- somebody actually writes their partner's number.
--
-- A validator that refuses the real answer does not get a better answer. It
-- gets an empty field, and an empty field in an emergency is the outcome this
-- was supposed to prevent.
--
-- So it is text. It is read by a person, not dialled by a machine. The only
-- limit kept is a length, which stops the column being used as free storage.

alter table profiles
  drop constraint if exists profiles_emergency_phone_is_e164;

do $$
begin
  alter table profiles add constraint profiles_emergency_phone_length
    check (
      emergency_contact_phone is null
      or length(btrim(emergency_contact_phone)) between 4 and 40
    );
exception
  when duplicate_object then null;
end $$;
