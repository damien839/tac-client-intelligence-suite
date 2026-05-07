"use server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface FreightAnalysisRecord {
  id: string;
  tenant_id: string;
  snapshot_json: unknown;
  report_json: unknown;
  schema_version: string;
  model: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  duration_ms: number | null;
  notes: string | null;
  created_at: string;
}

export async function saveAnalysis(input: {
  tenant_id: string;
  snapshot_json: unknown;
  report_json: unknown;
  schema_version: string;
  model?: string;
  tokens_input?: number;
  tokens_output?: number;
  duration_ms?: number;
  notes?: string;
}): Promise<FreightAnalysisRecord> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("freight_analyses")
    .insert({
      tenant_id: input.tenant_id,
      snapshot_json: input.snapshot_json,
      report_json: input.report_json,
      schema_version: input.schema_version,
      model: input.model ?? null,
      tokens_input: input.tokens_input ?? null,
      tokens_output: input.tokens_output ?? null,
      duration_ms: input.duration_ms ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`saveAnalysis: ${error.message}`);
  return data as FreightAnalysisRecord;
}

export async function getAnalysis(id: string): Promise<FreightAnalysisRecord | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("freight_analyses")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`getAnalysis: ${error.message}`);
  return (data as FreightAnalysisRecord | null) ?? null;
}

export async function listAnalysesForTenant(
  tenantId: string,
  limit = 20
): Promise<FreightAnalysisRecord[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("freight_analyses")
    .select("id, tenant_id, schema_version, model, tokens_input, tokens_output, duration_ms, notes, created_at, report_json, snapshot_json")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`listAnalysesForTenant: ${error.message}`);
  return (data ?? []) as FreightAnalysisRecord[];
}
