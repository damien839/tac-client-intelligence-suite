"use server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Carrier } from "@/lib/db/types";

export async function listCarriers(): Promise<Carrier[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("carriers")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw new Error(`listCarriers: ${error.message}`);
  return (data ?? []) as Carrier[];
}
