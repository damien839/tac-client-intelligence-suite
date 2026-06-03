/**
 * Backfill shipment_lines.resolved_zone using postcode_zones.dhl_zone_name.
 *
 * `dhl_zone_name` is now the canonical zone column for every carrier — see
 * getZoneColumn() in lib/freight/shipment-aggregator.ts. Re-resolves any line
 * whose current resolved_zone differs from the canonical mapping.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = readFileSync(".env.local", "utf8")
  .split("\n")
  .reduce((a, l) => {
    const m = l.match(/^([^=]+)=(.*)$/);
    if (m) a[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "");
    return a;
  }, {});

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function loadZoneMap() {
  const map = new Map();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb
      .from("postcode_zones")
      .select("postcode, dhl_zone_name")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.dhl_zone_name) map.set(r.postcode, r.dhl_zone_name);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return map;
}

async function loadAllLineKeys() {
  // Pull just (postcode, resolved_zone) for every line so we can decide which
  // postcodes need their zone rewritten without any heuristic on legacy values.
  const seen = new Map(); // postcode → Set(currentZones)
  let from = 0;
  const pageSize = 1000;
  let total = 0;
  while (true) {
    const { data, error } = await sb
      .from("shipment_lines")
      .select("postcode, resolved_zone")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) {
      const set = seen.get(r.postcode) ?? new Set();
      set.add(r.resolved_zone);
      seen.set(r.postcode, set);
    }
    total += data.length;
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { seen, total };
}

async function main() {
  console.log("Loading postcode_zones …");
  const zoneMap = await loadZoneMap();
  console.log(`  ${zoneMap.size} postcodes mapped`);

  console.log("Scanning shipment_lines …");
  const { seen, total } = await loadAllLineKeys();
  console.log(`  ${total} lines across ${seen.size} unique postcodes`);

  let updated = 0;
  let alreadyOk = 0;
  let skipped = 0;
  for (const [pc, currentZones] of seen) {
    const target = zoneMap.get(pc);
    if (!target) {
      skipped += 1;
      continue;
    }
    // Skip postcodes already fully on the canonical zone.
    if (currentZones.size === 1 && currentZones.has(target)) {
      alreadyOk += 1;
      continue;
    }
    const { error, count } = await sb
      .from("shipment_lines")
      .update({ resolved_zone: target }, { count: "exact" })
      .eq("postcode", pc)
      .neq("resolved_zone", target);
    if (error) {
      console.error(`  ${pc} → ${target}: ${error.message}`);
      continue;
    }
    updated += count ?? 0;
  }
  console.log(
    `Done. Updated ${updated} lines. Already canonical: ${alreadyOk} postcodes. Skipped (no zone map): ${skipped}.`
  );
}

await main();
