-- `disk_path` used to be absolute, resolved against the working directory at
-- upload time. Renaming or moving the checkout then orphaned every row: the
-- files were still there, but nothing could find them and every read 404'd.
-- Store the path relative to the configured upload directory instead, which is
-- where `uploadPath()` now resolves it against.
--
-- Safe as a blind rewrite because a file has always been named after the row
-- that describes it, under the directory its `kind` chooses.
UPDATE uploads
SET disk_path = CASE kind WHEN 'image' THEN 'images/' ELSE 'sheets/' END || id;
