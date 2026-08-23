-- A campaign runs at most one session at a time.
--
-- Two live sessions on the same campaign would give the same characters two
-- initiative orders and two turn markers, and a player joining with a code would
-- have no way to tell which table they had walked into.

-- Any campaign that already has more than one running keeps the newest and the
-- rest are ended, since the index below cannot be created otherwise.
UPDATE game_sessions
SET status = 'ended', ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'active'
  AND id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY campaign_id ORDER BY created_at DESC, id DESC
      ) AS rank
      FROM game_sessions
      WHERE status = 'active'
    )
    WHERE rank = 1
  );

-- Ended sessions are left out, so a campaign can be played again and again.
CREATE UNIQUE INDEX idx_game_sessions_one_active
  ON game_sessions(campaign_id)
  WHERE status = 'active';
