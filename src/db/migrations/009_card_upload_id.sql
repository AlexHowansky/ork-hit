-- The campaign/character image is the card artwork, not a backdrop behind it.
-- Rename the column to match what it actually is.
ALTER TABLE campaigns  RENAME COLUMN background_upload_id TO card_upload_id;
ALTER TABLE characters RENAME COLUMN background_upload_id TO card_upload_id;
