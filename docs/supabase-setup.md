# Supabase Setup

## Architecture

Use Supabase for PostgreSQL, Auth and private Storage:

```text
Extension -> Mnemonics API -> Supabase PostgreSQL
                         -> Supabase Storage (images)
                         -> Auth (later production login)
```

The API should use the database connection string for server-side writes and enforce `user_id` in every repository query. The client must never receive `SUPABASE_SERVICE_ROLE_KEY`.

## Create the project

1. Open [supabase.com](https://supabase.com) and create a new project.
2. Choose a strong database password and a nearby region.
3. Open **SQL Editor** and run `packages/database/migrations/001_create_items.sql`.
3. Open **SQL Editor** and run `packages/database/migrations/002_create_profiles.sql` after the items migration.
4. Open **Project Settings -> Database** and copy the connection string into a local `.env` as `DATABASE_URL`.
5. Open **Project Settings -> API** and copy the project URL and anon key into `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
6. Never commit the service role key. Keep it server-side only as `SUPABASE_SERVICE_ROLE_KEY` if a server-side Storage operation needs it.

## Admin role

New users are created with the `user` role. Promote the first administrator manually in SQL:

```sql
update public.profiles set role = 'admin' where id = '<auth-user-id>';
```

The API also recognizes `app_metadata.role = 'admin'` for JWTs issued after the metadata change.

## Development user

The API now uses Supabase JWTs. Create a user through the extension or **Authentication -> Users**, then sign in to obtain an access token. The old development token remains available only in API unit tests.

## Storage layout

Store assets under:

```text
<user_id>/<item_id>/<generated-file-name>.jpg
```

The bucket is private. Save only `storage_key`, MIME type and size in `assets`; do not put Base64 image data in PostgreSQL.

## Vector dimension

The migration uses `vector(1536)`, suitable for common 1536-dimensional embedding models. Pick the embedding model first and change both the migration and `EMBEDDING_DIMENSIONS` before inserting vectors. Do not mix dimensions in one embedding column.

## Verify

After setting `.env` and applying the migration:

```powershell
pnpm.cmd --filter @mnemonics/api dev
```

Then send an authenticated `POST /api/v1/captures` request. The response should be `201` with `status: "pending"`, and the item should appear in the Supabase `items` table.

For an image, reload the extension after starting the API, capture a screenshot, crop it and choose **Lưu vùng cắt vào Mnemonics**. The API stores the image in `Storage -> mnemonics-assets` and creates rows in `items` and `assets`. Verify with:

```sql
select id, type, title, status, created_at from public.items order by created_at desc;
select item_id, storage_key, mime_type, size_bytes from public.assets order by created_at desc;
```