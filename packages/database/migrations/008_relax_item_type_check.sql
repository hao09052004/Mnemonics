-- Allow the web + extension clients to use the richer item kinds
-- (`screenshot`, `quote`, `note`, `file`) introduced after the MVP.
-- The original constraint was too narrow and was rejecting legitimate
-- uploads from the browser extension.
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_type_check;

-- Recreate with a wider enum. We intentionally keep `link`, `text`,
-- `image` so existing rows remain valid.
ALTER TABLE items
  ADD CONSTRAINT items_type_check
  CHECK (type IN ('link', 'text', 'image', 'screenshot', 'quote', 'note', 'file'));
