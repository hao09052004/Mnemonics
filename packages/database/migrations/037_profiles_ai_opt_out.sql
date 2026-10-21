-- 037_profiles_ai_opt_out.sql
-- User preference for cloud AI opt-out.
-- When cloud_ai_opt_out is TRUE:
--   - User's content is not transmitted to external cloud LLM providers (Gemini).
--   - In-process / deterministic heuristics are used for tagging, OCR, and TLDR.
--   - Lexical keyword search remains fully functional.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS cloud_ai_opt_out BOOLEAN NOT NULL DEFAULT FALSE;
