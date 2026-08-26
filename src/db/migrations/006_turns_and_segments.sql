-- Turns and segments, in place of the round.
--
-- HERO does not run a fight as one list walked top to bottom. A Turn is twelve
-- segments long, SPD decides which of those segments a character acts in, and
-- DEX+INIT decides the order within a segment. So the counter is a Turn, and the
-- session carries the segment it has reached alongside it.
--
-- 12 is the default because that is where a fight opens: HERO starts combat on
-- Segment 12 of Turn 1, and Segment 1 first comes round on Turn 2.

ALTER TABLE game_sessions RENAME COLUMN round TO turn;
ALTER TABLE game_sessions ADD COLUMN segment INTEGER NOT NULL DEFAULT 12;

-- A fight half-tracked under the old model has no honest translation into turns
-- and segments: the round it had reached says nothing about which segment it was
-- on, and the order it was walking was dragged by hand rather than derived. So
-- the running sessions are ended rather than guessed at, exactly as ending one
-- from the app would leave them, and the table starts a fresh session.
--
-- Only sessions. Campaigns, characters and uploads — everything the game master
-- built and would mind losing — are untouched.
UPDATE game_sessions
SET status = 'ended',
    ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    active_slot_id = NULL,
    turn = 1,
    segment = 12
WHERE status = 'active';
