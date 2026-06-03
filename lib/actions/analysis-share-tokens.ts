"use server";

import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { FreightAnalysisRecord } from "./freight-analyses";

export interface ShareTokenRecord {
  token: string;
  analysis_id: string;
  tenant_id: string;
  created_by_email: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
}

export interface SharedAnalysis {
  token: ShareTokenRecord;
  analysis: FreightAnalysisRecord;
  tenant_name: string;
}

const DEFAULT_EXPIRY_DAYS = 30;

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function createShareToken(input: {
  analysis_id: string;
  created_by_email?: string | null;
  expires_in_days?: number | null;
}): Promise<ShareTokenRecord> {
  const supabase = getSupabaseAdmin();

  const { data: analysis, error: analysisErr } = await supabase
    .from("freight_analyses")
    .select("id, tenant_id")
    .eq("id", input.analysis_id)
    .maybeSingle();
  if (analysisErr) throw new Error(`createShareToken: ${analysisErr.message}`);
  if (!analysis) throw new Error(`createShareToken: analysis ${input.analysis_id} not found`);

  const days = input.expires_in_days ?? DEFAULT_EXPIRY_DAYS;
  const expiresAt =
    days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null;

  const token = generateToken();
  const { data, error } = await supabase
    .from("analysis_share_tokens")
    .insert({
      token,
      analysis_id: analysis.id,
      tenant_id: analysis.tenant_id,
      created_by_email: input.created_by_email ?? null,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) throw new Error(`createShareToken: ${error.message}`);
  return data as ShareTokenRecord;
}

export async function revokeShareToken(token: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("analysis_share_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token", token);
  if (error) throw new Error(`revokeShareToken: ${error.message}`);
}

export async function getSharedAnalysis(token: string): Promise<SharedAnalysis | null> {
  const supabase = getSupabaseAdmin();

  const { data: tokenRow, error: tokenErr } = await supabase
    .from("analysis_share_tokens")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (tokenErr) throw new Error(`getSharedAnalysis: ${tokenErr.message}`);
  if (!tokenRow) return null;

  const t = tokenRow as ShareTokenRecord;
  if (t.revoked_at) return null;
  if (t.expires_at && new Date(t.expires_at).getTime() < Date.now()) return null;

  const [analysisRes, tenantRes] = await Promise.all([
    supabase.from("freight_analyses").select("*").eq("id", t.analysis_id).maybeSingle(),
    supabase.from("tenants").select("name").eq("id", t.tenant_id).maybeSingle(),
  ]);
  if (analysisRes.error) throw new Error(`getSharedAnalysis: ${analysisRes.error.message}`);
  if (!analysisRes.data) return null;

  // Best-effort view counter; never fails the request.
  void supabase
    .from("analysis_share_tokens")
    .update({ view_count: t.view_count + 1, last_viewed_at: new Date().toISOString() })
    .eq("token", token);

  return {
    token: t,
    analysis: analysisRes.data as FreightAnalysisRecord,
    tenant_name: (tenantRes.data?.name as string | undefined) ?? "Tenant",
  };
}

export async function listShareTokensForAnalysis(
  analysisId: string
): Promise<ShareTokenRecord[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("analysis_share_tokens")
    .select("*")
    .eq("analysis_id", analysisId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listShareTokensForAnalysis: ${error.message}`);
  return (data ?? []) as ShareTokenRecord[];
}
