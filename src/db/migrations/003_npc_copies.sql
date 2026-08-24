-- More than one copy of an NPC on the stage.
--
-- A fight usually has more than one goblin, but the old stage could hold each
-- character once: the primary key was (game_session_id, character_id), so a
-- second copy was a conflict rather than a second monster. A stage row now has
-- an identity of its own, which is what lets two rows name the same character.
--
-- Existing stages are not carried across. This is a local tool that runs one
-- session at a time, the change lands between sessions, and preserving the old
-- rows would mean minting ids for them in SQL and rewriting the turn marker to
-- match — cost with no reader. Any session open across the upgrade comes back
-- with an empty initiative order, which the game master rebuilds in seconds.

DROP TABLE session_characters;

CREATE TABLE session_characters (
  -- The stage slot, not the character: this is what the initiative order is a
  -- list of, what the turn marker points at, and what a reorder names.
  id              TEXT PRIMARY KEY,
  game_session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  character_id    TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  -- Which copy of that character this is: 1 for the first, and thereafter one
  -- more than the highest ever used in this session. Deliberately not the row's
  -- place in the order — a copy keeps its number when another is removed or the
  -- order is dragged about, so "Goblin 3" names the same monster all fight.
  copy_number     INTEGER NOT NULL,
  position        INTEGER NOT NULL,
  added_at        TEXT NOT NULL
);

CREATE INDEX idx_session_characters_order ON session_characters(game_session_id, position);
-- No longer unique: that uniqueness was the old at-most-once rule.
CREATE INDEX idx_session_characters_character
  ON session_characters(game_session_id, character_id);

-- The turn marker points at a stage slot rather than a character, since a
-- character may now be standing in two places at once. No REFERENCES clause:
-- adding one needs a table rebuild, which with foreign keys on would cascade
-- through game_sessions and empty the players table. `sessionCharacters.remove`
-- clears the marker explicitly instead, as it already did.
ALTER TABLE game_sessions DROP COLUMN active_character_id;
ALTER TABLE game_sessions ADD COLUMN active_slot_id TEXT;
