# Database Package

Supabase PostgreSQL repository and first migration for capture items, assets, tags and embeddings.

Run the migrations in order in the Supabase SQL Editor before starting the API. `001_create_items.sql` enables `pgvector`, uses `auth.users.id` UUID ownership, enables RLS, creates the private `mnemonics-assets` Storage bucket and adds policies for user-owned data.

The embedding dimension is **`1024`**. Migration `001` declares it as 1536 and `017_embedding_dimensions_1024.sql` narrows it to 1024, which is the width shared by Gemini (`outputDimensionality=1024`) and the local fallback (`bge-m3`). Both providers write into the one column, so an embedding-space change requires a migration and a trigger update — see `specs/data/pgvector-config.md`.