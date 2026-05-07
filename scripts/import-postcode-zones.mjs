#!/usr/bin/env node
// Import the master postcode-zone xlsx into the postcode_zones table.
// Usage: node scripts/import-postcode-zones.mjs <path-to-xlsx>
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

await loadDotenv(path.join(ROOT, ".env.local"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node scripts/import-postcode-zones.mjs <path-to-xlsx>");
  process.exit(1);
}

const COLUMN_MAP = {
  postcode: "Postcode",
  ap_base_zone: "AP Base Zone",
  ap_zone_z40: "Australia Post Zone (Z40)",
  toll_zone: "Toll Zone",
  ap_z9_adl: "Australia Post (Z9) ADL",
  ap_z9_syd: "Australia Post (Z9) SYD",
  ap_z6_syd: "Australia Post (Z6) SYD",
  ap_z6_mel: "Australia Post (Z6) MEL",
  ap_z9_mel: "Australia Post (Z9) MEL",
  ap_z6_bne: "Australia Post (Z6) BNE",
  ap_z9_bne: "Australia Post (Z9) BNE",
  ap_z6_gld: "Australia Post (Z6) GLD",
  ap_z9_gld: "Australia Post (Z9) GLD",
  dhl_zone: "DHL AU Parcel Zone",
  dhl_zone_name: "DHL AU Parcel Zone Name",
};

const wb = XLSX.read(await readFile(filePath), { type: "buffer" });
const sheetName = wb.SheetNames[0];
const sheet = wb.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });

console.log(`Read ${rows.length} rows from ${path.basename(filePath)} → sheet "${sheetName}"`);

const sourceFile = path.basename(filePath);
const records = [];
const skipped = [];

for (const row of rows) {
  const raw = row[COLUMN_MAP.postcode];
  if (raw == null || String(raw).trim() === "") {
    skipped.push({ reason: "empty postcode", row });
    continue;
  }
  const postcode = String(raw).trim().padStart(4, "0");
  if (!/^\d{4}$/.test(postcode)) {
    skipped.push({ reason: "non-numeric postcode", value: raw });
    continue;
  }
  const record = { postcode, source_file: sourceFile };
  for (const [key, label] of Object.entries(COLUMN_MAP)) {
    if (key === "postcode") continue;
    const v = row[label];
    record[key] = v == null ? null : String(v).trim() || null;
  }
  records.push(record);
}

console.log(`Prepared ${records.length} records (${skipped.length} skipped)`);
if (skipped.length > 0) {
  console.log("Skipped sample:", skipped.slice(0, 3));
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CHUNK = 1000;
let upserted = 0;
for (let i = 0; i < records.length; i += CHUNK) {
  const chunk = records.slice(i, i + CHUNK);
  const { error, count } = await supabase
    .from("postcode_zones")
    .upsert(chunk, { onConflict: "postcode", count: "exact" });
  if (error) {
    console.error(`Chunk ${i}-${i + chunk.length} failed:`, error.message);
    process.exit(1);
  }
  upserted += count ?? chunk.length;
  process.stdout.write(`\r  ${upserted}/${records.length} upserted…`);
}
process.stdout.write("\n");

const { count: totalCount, error: countErr } = await supabase
  .from("postcode_zones")
  .select("*", { count: "exact", head: true });
if (countErr) {
  console.error("Count check failed:", countErr.message);
  process.exit(1);
}

console.log(`✓ Import complete. Table now has ${totalCount} rows.`);

async function loadDotenv(p) {
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
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
