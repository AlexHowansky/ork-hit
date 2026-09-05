-- CONSTITUTION, the last of the characteristics a fight is read from.
--
-- CON is looked up rather than spent: it is a number a character has, not one
-- that counts down during a fight, so unlike END, STUN and BODY it is recorded
-- once on `characters` and there is no per-slot copy of it on
-- `session_characters`. Two goblins beaten to different amounts of STUN still
-- have the same CON.
--
-- It earns its column because the table reads it out loud — it is what a stunning
-- hit is measured against — and because the sheets this app parses already print
-- it in the same table as SPD and REC, so it fills itself in.
--
-- Zero by default, for migration 004's reason: NOT NULL, so a character filed
-- before this reads as a characteristic nobody has filled in yet, which shows
-- plainly on screen, rather than as a blank every screen has to test for.

ALTER TABLE characters ADD COLUMN constitution INTEGER NOT NULL DEFAULT 0;
