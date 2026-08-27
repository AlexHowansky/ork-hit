-- Status tags: what condition a character on the stage is in.
--
-- Dead, prone, stunned, entangled and the rest are facts about *this copy in
-- this fight*, not about the character in the library: one goblin can be face
-- down while its twin is still swinging, and none of it means anything once the
-- session is over. So a tag hangs off the stage slot and dies with it, exactly
-- as the ENDURANCE and STUN that copy has left do.
--
-- A row per tag rather than a list in a column. What the app does to a tag is
-- set one and clear one; a set stored as text has to be read, edited and written
-- back, which is where two people pressing buttons in the same second lose one
-- of the presses.
--
-- Nothing existing changes meaning, so unlike 006 there is no session to end
-- here: a fight already running simply carries no tags, which is what it had
-- before this migration too.

CREATE TABLE session_character_tags (
  -- The slot, not the character. ON DELETE CASCADE is the whole of the cleanup:
  -- taking a copy off the stage takes its conditions with it and leaves its
  -- twin's alone, and ending a session drops the slots and so the tags.
  session_character_id TEXT NOT NULL REFERENCES session_characters(id) ON DELETE CASCADE,

  -- Either one of the names the app knows (`prone`, `stunned`, …) or whatever a
  -- game master typed. NOCASE so that "On fire" and "on fire" are one condition
  -- rather than two: a table types the same thing twice and means it once.
  tag                  TEXT NOT NULL COLLATE NOCASE,

  added_at             TEXT NOT NULL,

  -- The composite key is the rule itself: a character is prone or is not, and
  -- being told twice is not two pronenesses. It is also the index the read for a
  -- slot goes through, so no second one is wanted.
  PRIMARY KEY (session_character_id, tag)
) WITHOUT ROWID;

-- Deliberately no CHECK (tag IN (...)). Tags a table invents for itself are the
-- point of the feature, and SQLite cannot alter a check constraint without
-- rebuilding the table under live foreign keys. What a tag may look like — how
-- long, and which spellings fold onto a known one — is decided by the schema in
-- `src/lib/validate.ts` on the way in, next to every other such rule.
