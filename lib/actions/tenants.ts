"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Tenant, TenantKind } from "@/lib/db/types";

export async function listTenants(): Promise<Tenant[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw new Error(`listTenants: ${error.message}`);
  return (data ?? []) as Tenant[];
}

export async function getTenant(id: string): Promise<Tenant | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`getTenant: ${error.message}`);
  return (data as Tenant | null) ?? null;
}

export interface CreateTenantInput {
  name: string;
  kind: TenantKind;
  industry?: string;
  currency?: string;
  notes?: string;
}

export async function createTenant(input: CreateTenantInput): Promise<Tenant> {
  const trimmedName = input.name.trim();
  if (!trimmedName) throw new Error("Tenant name is required");

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tenants")
    .insert({
      name: trimmedName,
      kind: input.kind,
      industry: input.industry?.trim() || null,
      currency: input.currency ?? "AUD",
      notes: input.notes?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(`A tenant named "${trimmedName}" already exists`);
    }
    throw new Error(`createTenant: ${error.message}`);
  }

  revalidatePath("/tenants");
  return data as Tenant;
}
