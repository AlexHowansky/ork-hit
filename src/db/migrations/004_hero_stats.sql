-- HERO System 5th Edition Revised characteristics.
--
-- Every character here is a HERO System character, so the numbers a table
-- actually reaches for during play belong in the schema rather than in a sheet
-- the app cannot read: SPEED, DEXTERITY and RECOVERY, which are looked up, and
-- ENDURANCE, STUN and BODY, which are spent.
--
-- The three spendable ones are recorded twice, and the two are not the same
-- number. On `characters` they are the character's full total, which changes
-- only when the game master edits the library. On `session_characters` they are
-- what this copy has left right now: a stage slot is seeded from the library
-- when the character walks on and is its own number from then on, so a goblin
-- beaten down to 3 STUN stays there when a second goblin joins the fight, and
-- editing the library mid-session never quietly heals anyone.
--
-- Zero is the default because these are NOT NULL: characters that existed before
-- this migration read as zeros, which shows plainly on screen as a character
-- nobody has filled in yet, rather than as a blank the rest of the app would
-- have to keep testing for.

ALTER TABLE characters ADD COLUMN speed     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN dexterity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN recovery  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN endurance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN stun      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN body      INTEGER NOT NULL DEFAULT 0;

-- What the slot has left, seeded from the character's totals when it is added.
ALTER TABLE session_characters ADD COLUMN cur_endurance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_characters ADD COLUMN cur_stun      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_characters ADD COLUMN cur_body      INTEGER NOT NULL DEFAULT 0;
