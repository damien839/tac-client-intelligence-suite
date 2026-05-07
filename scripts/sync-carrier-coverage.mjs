#!/usr/bin/env node
// Sync carrier × postcode coverage from the ECX multi-carrier app's
// `carrier_rates` table into the TAC CIS `carrier_postcode_coverage` table.
//
// Read source: ECX Supabase (env from <ecx-path>/.env.local)
// Write target: TAC CIS Supabase (env from this project's .env.local)
//
// Usage:
//   node scripts/sync-carrier-coverage.mjs                    # default ECX path
//   node scripts/sync-carrier-coverage.mjs --ecx <path>       # custom ECX path
//   node scripts/sync-carrier-coverage.mjs --dry-run          # no writes
//
// What it does:
//   1. Loads ECX env, fetches all current non-void carrier_rates pages
//      (effective_to is null, is_void = false) along with the carrier_service
//      → (carrier_code, service_code) and postcode_id → postcode lookups.
//   2. Aggregates per (carrier_code, service_code, postcode):
//        rate_count, min_cost_aud, max_cost_aud
//   3. Loads TAC CIS env, upserts the rollup into carrier_postcode_coverage
//      (chunks of 1000, onConflict on the composite PK).
//   4. Prints summary counts per (carrier, service).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import os from "node:os";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const args = parseArgs(process.argv.slice(2));
const ecxRoot = args.ecx
  ? path.resolve(args.ecx)
  : path.join(os.homedir(), "projects/ecx-carrier-tool");
const dryRun = Boolean(args["dry-run"]);

const ecxEnv = await loadDotenv(path.join(ecxRoot, ".env.local"));
const tacEnv = await loadDotenv(path.join(ROOT, ".env.local"));

const ECX_URL = ecxEnv.NEXT_PUBLIC_SUPABASE_URL;
const ECX_SR = ecxEnv.SUPABASE_SERVICE_ROLE_KEY;
const TAC_URL = tacEnv.NEXT_PUBLIC_SUPABASE_URL;
const TAC_SR = tacEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!ECX_URL || !ECX_SR) {
  console.error(`Missing ECX env at ${ecxRoot}/.env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`);
  process.exit(1);
}
if (!dryRun && (!TAC_URL || !TAC_SR)) {
  console.error("Missing TAC CIS env (.env.local)");
  process.exit(1);
}

if (ECX_URL === TAC_URL) {
  console.error("Refusing to run: ECX and TAC CIS Supabase URLs match. Did .env.local point at the wrong project?");
  process.exit(1);
}

const ecx = createClient(ECX_URL, ECX_SR, { auth: { persistSession: false } });
const tac = dryRun
  ? null
  : createClient(TAC_URL, TAC_SR, { auth: { persistSession: false } });

console.log(`ECX source: ${ECX_URL}`);
if (!dryRun) console.log(`TAC target: ${TAC_URL}`);
else console.log("DRY RUN — no writes");

// ── 1. Build (carrier_service_id) → {carrier_code, service_code} ──
const carrierServiceMap = await loadCarrierServiceMap(ecx);
console.log(`Loaded ${carrierServiceMap.size} carrier_services`);

// ── 2. Build postcode_id → postcode (4-char) ──
const postcodeMap = await loadPostcodeMap(ecx);
console.log(`Loaded ${postcodeMap.size} ECX postcodes`);

// ── 3. Page through carrier_rates (current, non-void) ──
const rollup = new Map(); // key: `${carrier_code}|${service_code}|${postcode}` → {rate_count, min, max}
let scanned = 0;
const PAGE = 1000;
let from = 0;
for (;;) {
  const { data, error } = await ecx
    .from("carrier_rates")
    .select("carrier_service_id, postcode_id, cost_aud, is_void, effective_to")
    .is("effective_to", null)
    .eq("is_void", false)
    .order("id", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) {
    console.error("ECX carrier_rates fetch failed:", error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) break;

  for (const row of data) {
    const cs = carrierServiceMap.get(row.carrier_service_id);
    const pc = postcodeMap.get(row.postcode_id);
    if (!cs || !pc) continue;
    if (row.cost_aud == null) continue;
    const key = `${cs.carrier_code}|${cs.service_code}|${pc}`;
    const cost = Number(row.cost_aud);
    const existing = rollup.get(key);
    if (!existing) {
      rollup.set(key, { count: 1, min: cost, max: cost });
    } else {
      existing.count += 1;
      if (cost < existing.min) existing.min = cost;
      if (cost > existing.max) existing.max = cost;
    }
  }

  scanned += data.length;
  process.stdout.write(`\r  scanned ${scanned} rate rows…`);
  if (data.length < PAGE) break;
  from += PAGE;
}
process.stdout.write("\n");

console.log(`Aggregated ${rollup.size} (carrier, service, postcode) tuples`);

// ── 4. Per-carrier-service summary ──
const summary = new Map();
for (const [key, val] of rollup) {
  const [carrier, service] = key.split("|");
  const k = `${carrier}|${service}`;
  summary.set(k, (summary.get(k) ?? 0) + 1);
}
console.log("\nCoverage per carrier_service:");
for (const [k, n] of [...summary.entries()].sort()) {
  const [c, s] = k.split("|");
  console.log(`  ${c.padEnd(20)} ${s.padEnd(20)} ${n} postcodes`);
}

if (dryRun) {
  console.log("\nDry run complete.");
  process.exit(0);
}

// ── 5. Upsert into TAC CIS carrier_postcode_coverage ──
const records = [];
const sourceTag = `ecx-mirror @ ${new Date().toISOString().slice(0, 10)}`;
for (const [key, val] of rollup) {
  const [carrier_code, service_code, postcode] = key.split("|");
  records.push({
    carrier_code,
    service_code,
    postcode,
    is_covered: true,
    rate_count: val.count,
    min_cost_aud: round2(val.min),
    max_cost_aud: round2(val.max),
    source: sourceTag,
  });
}

const CHUNK = 1000;
let upserted = 0;
for (let i = 0; i < records.length; i += CHUNK) {
  const chunk = records.slice(i, i + CHUNK);
  const { error, count } = await tac
    .from("carrier_postcode_coverage")
    .upsert(chunk, {
      onConflict: "carrier_code,service_code,postcode",
      count: "exact",
    });
  if (error) {
    console.error(`\nChunk ${i}-${i + chunk.length} failed:`, error.message);
    process.exit(1);
  }
  upserted += count ?? chunk.length;
  process.stdout.write(`\r  ${upserted}/${records.length} upserted…`);
}
process.stdout.write("\n");

const { count: totalCount, error: countErr } = await tac
  .from("carrier_postcode_coverage")
  .select("*", { count: "exact", head: true });
if (countErr) {
  console.error("Count check failed:", countErr.message);
  process.exit(1);
}
console.log(`✓ Sync complete. carrier_postcode_coverage now has ${totalCount} rows.`);

// ── helpers ──
async function loadCarrierServiceMap(client) {
  const { data, error } = await client
    .from("carrier_services")
    .select("id, carrier:carriers(code), service_level:service_levels(code)")
    .eq("is_active", true);
  if (error) throw new Error(`carrier_services fetch: ${error.message}`);
  const map = new Map();
  for (const row of data ?? []) {
    if (!row.carrier?.code || !row.service_level?.code) continue;
    map.set(row.id, {
      carrier_code: row.carrier.code,
      service_code: row.service_level.code,
    });
  }
  return map;
}

async function loadPostcodeMap(client) {
  const map = new Map();
  let from = 0;
  const PAGE_LOCAL = 1000;
  for (;;) {
    const { data, error } = await client
      .from("postcodes")
      .select("id, postcode")
      .order("postcode", { ascending: true })
      .range(from, from + PAGE_LOCAL - 1);
    if (error) throw new Error(`postcodes fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const pc = String(row.postcode).trim().padStart(4, "0");
      if (/^\d{4}$/.test(pc)) map.set(row.id, pc);
    }
    if (data.length < PAGE_LOCAL) break;
    from += PAGE_LOCAL;
  }
  return map;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[k] = next;
      i += 1;
    } else {
      out[k] = true;
    }
  }
  return out;
}

async function loadDotenv(p) {
  const out = {};
  try {
    const txt = await readFile(p, "utf8");
    for (const line of txt.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return out;
}
