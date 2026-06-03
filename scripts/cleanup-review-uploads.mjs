/**
 * Delete shipment_lines + freight_uploads rows for any upload still in
 * `review` status. Useful after a code fix in the extract pipeline (e.g.
 * service-code detection) when you want a clean slate before the user
 * re-uploads the same file.
 *
 * Committed uploads (status != 'review') are left alone.
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

const { data: uploads, error } = await sb
  .from("freight_uploads")
  .select("id, tenant_id, carrier_id, status, created_at")
  .eq("status", "review")
  .order("created_at", { ascending: false });
if (error) throw error;

console.log(`Found ${uploads?.length ?? 0} uploads in review status:`);
for (const u of uploads ?? []) {
  console.log(`  ${u.id}  tenant=${u.tenant_id}  carrier=${u.carrier_id}  ${u.created_at}`);
}

if (!uploads || uploads.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

let deletedLines = 0;
for (const u of uploads) {
  const { count, error: lErr } = await sb
    .from("shipment_lines")
    .delete({ count: "exact" })
    .eq("upload_id", u.id);
  if (lErr) {
    console.error(`  lines for ${u.id}: ${lErr.message}`);
    continue;
  }
  deletedLines += count ?? 0;
  const { error: uErr } = await sb.from("freight_uploads").delete().eq("id", u.id);
  if (uErr) console.error(`  upload ${u.id}: ${uErr.message}`);
}

console.log(`Deleted ${deletedLines} shipment_lines and ${uploads.length} review uploads.`);
