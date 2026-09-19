# Database Package

Supabase PostgreSQL repository and first migration for capture items, assets, tags and embeddings.

Run `migrations/001_create_items.sql` in the Supabase SQL Editor before starting the API. It enables `pgvector`, uses `auth.users.id` UUID ownership, enables RLS, creates the private `mnemonics-assets` Storage bucket and adds policies for user-owned data. The embedding dimension is currently `1536`; change it before running the migration if a different model is selected.