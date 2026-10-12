/**
 * Tiny dotenv loader for the migration runner. The .env file is
 * consumed by the API process via `dotenvx`; this loader exists
 * so the migration script can be invoked by hand from a fresh
 * shell without bringing the whole dotenvx stack along.
 */
import { readFileSync } from "node:fs";

const envPath = process.argv[2] ?? "../../.env";
const text = readFileSync(envPath, "utf8");
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  const key = m[1];
  let val = m[2];
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
  if (process.env[key] === undefined) process.env[key] = val;
}
