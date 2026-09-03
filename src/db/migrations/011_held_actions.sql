-- Holding an action: a character says "I'm waiting", and cuts back in later.
--
-- The hold hangs off the stage slot, as the status tags and the vitals do. It is
-- a fact about this copy in this fight — one goblin can be waiting while its
-- twin swings — and it dies with the slot, which is the whole of the cleanup.
--
-- `resume_slot_id` is the other half, and it belongs to the session because it
-- is a fact about the clock rather than about anybody on the stage: whose phase
-- a holder cut into, so the next press of Next can hand it back to them rather
-- than walking on past a phase that never finished. Null is the ordinary state,
-- which is what every existing row gets and what the fight has whenever nothing
-- is pending.
--
-- On the session rather than in the browser for the same reason the segment walk
-- is on the server: two game master tabs must not be able to disagree about
-- where the fight is.
--
-- Nothing existing changes meaning, so as in 007 and 008 there is no session to
-- end here: a fight already running simply has nobody holding.

ALTER TABLE session_characters ADD COLUMN held INTEGER NOT NULL DEFAULT 0;
ALTER TABLE game_sessions      ADD COLUMN resume_slot_id TEXT;
