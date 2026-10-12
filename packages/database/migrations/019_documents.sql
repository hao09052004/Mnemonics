-- Document Capture — first-class `document` kind.
--
-- Why this exists on top of 008 (which already accepts 'file'):
--
--   1. The product vocabulary is `document` (matches the chip label
--      the user sees). `file` was a generic placeholder from the
--      earlier relaxation of `items_type_check` and was never
--      wired to anything. We rename the constraint so the canonical
--      kind matches the canonical UI label.
--
--   2. `assets.mime_type` was restricted to image/* so a PDF upload
--      would have failed the CHECK. The constraint is widened to the
--      closed set of document kinds we actually support
--      (application/pdf, text/plain, text/markdown) so the row is
--      created with the right content type but a stray client cannot
--      smuggle in `application/octet-stream`.
--
--   3. `assets.original_filename` is the user's chosen name. We
--      previously sanitised it into the storage key; the original
--      was lost. The dashboard now shows the original (e.g. for the
--      download action) so persisting it is cheap and useful.
--
--   4. `items.page_count` is the PDF page count when the document
--      has one. NULL for text/markdown. We store it as a nullable
--      column rather than a new metadata column because the card UI
--      already shows a `NN pages` line and reading a single column
--      is cheaper than parsing JSON.
--
--   5. `jobs.type` is widened to accept the new `extract_document`
--      job. Existing rows remain valid; the migration only adds a
--      value to the closed set.

BEGIN;

-- ----- 1. items.type -----------------------------------------------------
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_type_check;

ALTER TABLE items
  ADD CONSTRAINT items_type_check
  CHECK (type IN ('link', 'text', 'image', 'screenshot', 'quote', 'note', 'file', 'document'));

-- ----- 2. assets.mime_type + original_filename --------------------------
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_mime_type_check;

ALTER TABLE assets
  ADD CONSTRAINT assets_mime_type_check
  CHECK (mime_type IN (
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf', 'text/plain', 'text/markdown'
  ));

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS original_filename TEXT;

ALTER TABLE assets
  DROP CONSTRAINT IF EXISTS assets_size_bytes_check;

ALTER TABLE assets
  ADD CONSTRAINT assets_size_bytes_check
  CHECK (size_bytes > 0 AND size_bytes <= 20971520); -- 20 MiB cap

-- ----- 3. items.page_count ----------------------------------------------
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS page_count INTEGER
  CHECK (page_count IS NULL OR page_count >= 0);

-- ----- 4. jobs.type allows extract_document ------------------------------
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('ocr', 'tag', 'embed', 'enrich', 'extract_document'));

-- ----- 5. item_enrichments tracks document extraction outcomes ---------
-- Documents have a separate "extraction_status" because the operation is
-- distinct from caption / tldr: it reads bytes from storage, parses
-- them, and persists raw_text. We persist the status + error_code so
-- the dashboard can show "Processing document…" vs "Text extraction
-- unavailable" without leaking the parser name.
ALTER TABLE item_enrichments
  ADD COLUMN IF NOT EXISTS extraction_status TEXT
  CHECK (extraction_status IS NULL OR extraction_status IN ('pending', 'processing', 'ready', 'failed'));

ALTER TABLE item_enrichments
  ADD COLUMN IF NOT EXISTS extraction_error_code TEXT;

COMMIT;