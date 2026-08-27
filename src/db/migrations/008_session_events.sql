-- The log: what has happened at this table, in the order it happened.
--
-- Everything the app knew until now was state — what is true at this moment,
-- rebuilt from scratch into every snapshot. A notice was the one exception, and
-- it is deliberately kept nowhere: it is a toast about something the table has
-- already moved on from, and a client that reconnects should not be told about
-- it again.
--
-- The log is neither. It is a history, and a history that only lived in the
-- browsers watching at the time would be no history at all: a reload would empty
-- it, and a player who joins ten minutes in would see nothing of the ten minutes.
-- The very first event proves the point — a session is started before any screen
-- is watching it, so `Session started` can only ever be read out of the database.
--
-- So it is stored, and it rides the session snapshot with everything else. That
-- is what makes a reconnecting screen correct rather than merely up to date.
--
-- Nothing existing changes meaning, so unlike 006 there is no session to end
-- here: a fight already running simply carries an empty log, and gains its
-- events from here on.

CREATE TABLE session_events (
  id              TEXT PRIMARY KEY,

  -- ON DELETE CASCADE is the whole of the cleanup, as it is for tags and slots.
  -- Note that *ending* a session does not reach here: that only flips the status,
  -- and a game master looking back at a finished session should still find its
  -- log. It is deleting the campaign that takes the sessions, and their logs
  -- with them.
  game_session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,

  -- The sentence as it will be read, written once by whoever caused it. Stored
  -- rather than composed from a code and some ids at read time: an event is a
  -- record of what was true then, and a character renamed afterwards must not
  -- rewrite the line about what they did.
  message         TEXT NOT NULL,

  created_at      TEXT NOT NULL
);

-- The only read there is: one session's events, oldest first. `id` is in the
-- index because it is what settles the order — ids are time-ordered, so two
-- events recorded inside the same second still come back in the order they
-- happened rather than in whatever order the b-tree found them.
CREATE INDEX session_events_by_session
  ON session_events (game_session_id, created_at, id);
