-- Add a free-form `notes` column to items so users can attach a personal
-- annotation to a captured memory. Default NULL so every existing row
-- stays untouched. No length cap at the column level — the API enforces
-- a 4000-char limit before insert/update so a runaway client cannot
-- push megabytes of text into a single row.

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS notes TEXT;