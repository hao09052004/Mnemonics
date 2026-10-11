# Mnemonics — Production Deployment Checklist

> **Companion to `docs/production-readiness-audit.md`.**
> **Read the audit first; this is the runbook for going live.**

This checklist is the **operator-facing procedure** for taking
Mnemonics from "code is ready" to "production deployment verified."

Do **not** skip a step. Every box is gated by something concrete.

---

## Pre-flight: what to read first

1. `docs/production-readiness-audit.md` — the audit that this checklist executes.
2. `AGENTS.md` — repo entry point.
3. `docs/deployment.md` — the existing deployment doc; this checklist **supersedes** it where they disagree.
4. `docs/privacy.md` — privacy notice that ships with the product.
5. `.env.example` and `.env.production.example` at the repo root.

---

## Stage 0 — Operator prerequisites

These require the operator's real account access. The agent cannot
perform them; the operator must do them and paste the result back.

- [ ] **Supabase project exists** (the production one). If not, create
      a new one at <https://supabase.com>. Note the project ref.
- [ ] **Google AI Studio API key** with Free Tier access. Create at
      <https://aistudio.google.com/apikey>. Confirm it is **not** a
      paid key (the dashboard will say so).
- [ ] **Render account** at <https://render.com> (free plan is fine).
- [ ] **Cloudflare account** at <https://dash.cloudflare.com> (free
      plan is fine).
- [ ] **GitHub account** with push access to the repo
      (`hao09052004/Mnemonics`).
- [ ] **Chrome Web Store** developer account (one-time $5 fee).
- [ ] **Edge Add-ons** developer account (free).

---

## Stage 1 — Local environment

- [ ] `pnpm install` from the repo root.
- [ ] `pnpm typecheck` — must finish with 0 errors.
- [ ] `pnpm -r test` — must finish green.
- [ ] `pnpm build` — must finish green.
- [ ] `cp .env.example .env` and fill in only the **local** values
      (no production keys).
- [ ] `pnpm --filter @mnemonics/api dev` — should bind to
      `http://localhost:3001` and `GET /` should return
      `{"name":"Mnemonics API", "status":"ok"}`.

If any of these fail, **do not proceed**.

---

## Stage 2 — Staging Supabase project

Create a **separate** Supabase project for staging. Do not reuse the
production project.

- [ ] Create project named `mnemonics-staging`.
- [ ] Note the project URL and the `anon` and `service_role` keys.
- [ ] In the SQL editor, run the verification query:
  ```sql
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'item_embeddings'
    AND column_name IN ('embedding_kind', 'model_name', 'pipeline_version');
  ```
  At least `embedding_kind` should be present after migrations 017+
  are applied.
- [ ] In **Storage**, create the bucket `mnemonics-assets` and
  mark it **Private**.
- [ ] In **Authentication → Providers**, enable **Email/Password**.
- [ ] (Optional) Enable **Confirm email** if you want to test the
  full email flow.
- [ ] Disable **Auto Confirm** unless the staging project is for
  internal use only.

---

## Stage 3 — Apply migrations to staging

From your local checkout, with `DATABASE_URL` pointing to the
staging pooler:

- [ ] `pnpm --filter @mnemonics/database migrate --dry-run` — must
      finish with **no destructive** changes. (Forward-only column
      additions are fine; any DROP / TRUNCATE / ALTER TYPE that
      changes shape is a blocker.)
- [ ] `pnpm --filter @mnemonics/database migrate --apply` — applies
      the pending migrations.
- [ ] Verify by re-running the verification query from Stage 2; the
      `embedding_kind` column should exist.
- [ ] `pnpm --filter @mnemonics/database recover-failed-embed-jobs --dry-run`
      — should report 0 failed jobs on a clean staging project.
- [ ] Reload the PostgREST schema cache:
      ```sql
      NOTIFY pgrst, 'reload schema';
      ```

---

## Stage 4 — Deploy the API to Render

- [ ] Fork or copy `deploy/render.yaml` from this repo. **Do not**
      use the previous manifest — it provisioned paid services.
- [ ] In Render, create a new **Web Service** from the GitHub repo.
- [ ] Build command: `pnpm install && pnpm --filter @mnemonics/api build`.
- [ ] Start command: `pnpm --filter @mnemonics/api start`.
- [ ] Plan: **Free**.
- [ ] Region: closest to the staging Supabase region.
- [ ] Environment variables — paste the **staging** values, NEVER
      the production values:
  - `NODE_ENV=production`
  - `DATABASE_URL=<staging pooler>`
  - `SUPABASE_URL=<staging URL>`
  - `SUPABASE_ANON_KEY=<staging anon>`
  - `SUPABASE_SERVICE_ROLE_KEY=<staging service role>`
  - `GEMINI_API_KEY=<staging Gemini key>`
  - `DEMO_MODE=false`
  - `AUTH_AUTO_CONFIRM=false`
  - `CORS_ALLOWED_ORIGNS=https://staging.mnemonics.example`
  - `AI_USER_DAILY_LIMIT=100`
  - `AI_TEXT_FALLBACK=false`
  - `AI_EMBEDDING_FALLBACK=false`
  - `OCR_LOCAL_FALLBACK=false`
  - `GEMINI_REQUEST_TIMEOUT_MS=45000`
  - `GEMINI_QUEUE_WAIT_TIMEOUT_MS=30000`
  - `GEMINI_TOTAL_BUDGET_MS=60000`
  - `GEMINI_TLDR_TOTAL_BUDGET_MS=90000`
- [ ] Deploy. The first deploy will take ~3 minutes.
- [ ] Verify: `curl https://<staging-api>.onrender.com/` returns the
      expected JSON.
- [ ] Verify: `curl https://<staging-api>.onrender.com/api/v1/health`
      returns `{"data":{"status":"ok"}}`.

---

## Stage 5 — Deploy the web to Cloudflare Pages

- [ ] In Cloudflare Pages, create a project pointing at the GitHub
      repo. **Build command**: `pnpm --filter @mnemonics/web build`.
      **Output directory**: `apps/web/dist`.
- [ ] Environment variables (Vite — must use `VITE_` prefix):
  - `VITE_API_URL=https://<staging-api>.onrender.com`
  - `VITE_WEB_URL=https://<staging-web>.pages.dev`
  - `VITE_DEMO_MODE=false`
- [ ] Deploy. The first deploy will take ~2 minutes.
- [ ] Visit `https://<staging-web>.pages.dev` and confirm the
      dashboard loads.

---

## Stage 6 — Smoke test the staging environment

Open the staging web URL in a browser. Execute **all** of these
journeys. Every box must be ticked.

### Journey A — First-time user

- [ ] Sign up with a real email you control.
- [ ] Confirm the email if `Confirm email` is enabled.
- [ ] Log in.
- [ ] Open the dashboard. "Everything" should be empty.
- [ ] Click **Save Link** → enter a real URL → submit. Within 10s
      the memory should appear in "Everything" with Gemini tags and
      a TLDR.
- [ ] Click **Quick Note** → enter a Vietnamese note with diacritics
      → submit. Within 10s the memory should appear with the
      diacritics preserved.
- [ ] Click **Upload Image** → upload a JPEG screenshot → submit.
      Within 30s the image should appear with OCR text, a caption,
      and a TLDR.
- [ ] Click **Upload Document** → upload a multi-page PDF → submit.
      Within 60s the document should appear with extracted text and
      chunked embeddings.
- [ ] Click each memory card → it should navigate to `/app/items/:id`
      and render the full detail.
- [ ] Log out → log back in → confirm the same four memories
      persist.

### Journey B — Extension

- [ ] Run `pnpm extension:package` to produce a ZIP.
- [ ] Unzip the ZIP and run the secret scan:
  ```bash
  unzip -l dist/mnemonics-extension.zip | grep -E '\.env$|service_role|AIza|localhost'
  ```
  Expected: **no matches**.
- [ ] Load the unpacked extension in Chrome (chrome://extensions →
  Developer mode → Load unpacked).
- [ ] Log in with the same account.
- [ ] Capture a webpage, a selection, a screenshot, a PDF. Each
  should land in the extension's "Everything" within 30s.
- [ ] Open the same memories in the web dashboard. The same four
  should appear.
- [ ] Delete one from the web. It should disappear from the
  extension on next refresh.

### Journey C — Gemini degradation

- [ ] Set `GEMINI_API_KEY=invalid_key` in the API environment and
      redeploy. The new captures should still save but with
      `status=processing` and `auth_failure` in the AI diagnostics.
- [ ] Restore the real key.
- [ ] Set `GEMINI_RATE_LIMIT_RPM=0.1` (force the RPM pacer to
      back-off heavily) and capture 5 things in quick succession.
      After ~60s, the pacer should have caught up; all 5 memories
      should be enriched. No `Gemini total budget exceeded` errors.

### Journey D — Semantic search

- [ ] Save 3 memories about a similar topic and 3 memories about an
      unrelated topic. Spread them across 2 days.
- [ ] Search by keyword; results should match the 3 related ones.
- [ ] Toggle semantic search; results should still match, with
      similarity scores visible.
- [ ] Verify in the database:
      ```sql
      SELECT embedding_kind, COUNT(*) FROM item_embeddings GROUP BY embedding_kind;
      ```
      All rows should share **one** `embedding_kind` value.

### Journey E — PDF

- [ ] Upload a 10-page PDF.
- [ ] Within 90s the memory should have `item_embeddings` row plus
      multiple `item_document_chunks` rows.
- [ ] Search for text from page 9 specifically; it should be
      retrievable.

### Journey F — Spaces and clusters

- [ ] Create a Manual Space, add 3 memories, remove 1, confirm the
      remaining 2.
- [ ] Save a Cluster as a Space; confirm the membership matches.
- [ ] Open a Cluster detail with 50+ members; paginate to the end
      with the **Load more** button; every member must be reachable.

### Journey G — Auth expiry

- [ ] Wait for the access token to expire (default 1h).
- [ ] Reload the page. The session should auto-refresh; the user
      should not be logged out.
- [ ] Force-revoke the refresh token in the Supabase dashboard.
- [ ] Reload again; the user should be redirected to the login
      page with a "session expired" message.

### Journey H — Multi-user isolation

- [ ] Create User A and User B.
- [ ] User A saves 3 memories.
- [ ] User B's "Everything" should show 0 of them.
- [ ] User B's `/api/v1/items?userId=<A's id>` call should return
      **403**, not the data.
- [ ] User B's semantic search with User A's text should return 0
      results.
- [ ] User B's quota should be **separate** from User A's.

If any of these fail, **do not proceed**. File a bug, fix it, redeploy,
re-run the failed journey.

---

## Stage 7 — Promote to production

Only after the full Stage 6 is green:

- [ ] Re-create the env-var set in the Render dashboard, this time
      with the **production** Supabase URL, the **production**
      Supabase keys, and the **production** Gemini key.
- [ ] Update `CORS_ALLOWED_ORIGNS` to the production web origin
      (no staging URL).
- [ ] Repeat Stage 2-3 against the production Supabase project.
- [ ] Repeat Stage 5 with `VITE_API_URL` pointing to the production
      API and `VITE_WEB_URL` pointing to the production web origin.
- [ ] Repeat Stage 6 against the production URLs. This is the
      **final** smoke run.

---

## Stage 8 — Publish the extension

- [ ] Run `pnpm extension:package` with the production URLs in
      `MNEMONICS_API_URL` and `MNEMONICS_WEB_URL`.
- [ ] Re-run the secret scan from Journey B.
- [ ] Upload the ZIP to the Chrome Web Store as **unlisted**.
- [ ] Upload the ZIP to the Edge Add-ons as **unlisted**.
- [ ] Confirm the public listing URLs.

---

## Stage 9 — Operator handoff

- [ ] The dashboard at the production web URL is live and reachable.
- [ ] The staging URL is preserved for one release cycle, then
      archived.
- [ ] The Supabase staging project is kept for one release cycle,
      then archived.
- [ ] All env-var sets have been written down in the team's password
      manager (1Password / Vault). **Never** in the repo.
- [ ] The agent has been instructed to **never** push to the
      production Supabase project, never deploy to Render, and
      never publish to the extension stores without explicit
      operator approval.

---

## Rollback

If a production smoke run fails:

- [ ] Revert the Render service to the previous deploy (Render keeps
      every deploy for 90 days).
- [ ] Revert the Cloudflare Pages project to the previous deploy
      (Cloudflare keeps every deploy for 30 days).
- [ ] Database migrations are **forward-only**; there is no
      automatic rollback. If a migration is bad, write a new
      migration to undo the change and apply it.
- [ ] If a Gemini key was leaked, rotate it in the AI Studio
      dashboard and update the Render env-var set.

---

## What the agent will **not** do

Per the milestone's non-negotiable rules:

- [ ] The agent will not deploy to Render or Cloudflare.
- [ ] The agent will not modify the production Supabase schema.
- [ ] The agent will not push secrets to the repo.
- [ ] The agent will not enable paid Gemini models.
- [ ] The agent will not publish the extension to the stores.
- [ ] The agent will not run destructive database operations
      (DROP / TRUNCATE / DELETE) against any environment.

The agent writes code, runs tests, and produces this checklist.
The operator executes it.

---

**End of checklist.**
