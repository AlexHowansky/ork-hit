-- INITIATIVE: the part of a character's initiative that DEX does not explain.
--
-- HERO orders a phase by DEX, but a character may act earlier than their DEX
-- alone would put them — Combat Reflexes and the like. That bonus is a separate
-- number on the sheet, so it is a separate column here rather than something
-- baked into `dexterity`, which has to keep meaning DEX for every other use.
--
-- Zero is the default, and for the same reason as the characteristics added in
-- 004: the column is NOT NULL, and a character from before this migration reads
-- as a bonus of nought, which is exactly what "no bonus" is.

ALTER TABLE characters ADD COLUMN initiative INTEGER NOT NULL DEFAULT 0;
