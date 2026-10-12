# Gate 04 — Security

* **Owner:** `agents/core/security-reviewer.md`
* **Runner:** `../runners/lint-all.sh` (semgrep ruleset) + gitleaks
* **Fires on:** `pre-merge`, nightly, on any change under `apps/api/auth/**`
* **Failure semantics:** blocks transitions `review → verify` and
  `verify → release`.

## Rule

No new high/critical findings from:

* `semgrep --config=p/owasp-top-ten --config=p/javascript --config=p/typescript`
* `semgrep --config=p/secrets`
* `gitleaks detect --redact`

Plus, manual checks for any change touching:

* Supabase RLS policies
* JWT handling
* Service-role usage
* Network egress to new origins (any new URL must be in
  `specs/0001-system-overview.md §6`)

## Evidence

Full report stored at `quality-gates/.logs/04-security-<date>.log` plus a
machine-readable summary under `.coverage/04-security-<date>.json`.

## Remediation

1. For secrets: rotate immediately, then remove.
2. For RLS: deny first, then write the policy.
3. For new egress: open an ADR.
