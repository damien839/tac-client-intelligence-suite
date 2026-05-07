export type TenantKind = "client" | "prospect";

export interface Tenant {
  id: string;
  name: string;
  kind: TenantKind;
  industry: string | null;
  currency: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Carrier {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
}

export type UploadKind = "billing" | "current_rate_card" | "new_rate_card";
export type UploadStatus =
  | "pending"
  | "extracting"
  | "review"
  | "committed"
  | "rejected"
  | "failed";
export type FileFormat = "pdf" | "xlsx" | "csv";

export interface FreightUpload {
  id: string;
  tenant_id: string;
  carrier_id: string | null;
  upload_kind: UploadKind;
  file_format: FileFormat;
  file_name: string;
  storage_path: string | null;
  status: UploadStatus;
  claude_model: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  extracted_payload: unknown;
  reviewed_payload: unknown;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type RateCardStatus = "current" | "new" | "archived";
export type RateBasis = "per_parcel" | "per_kg" | "per_parcel_plus_per_kg";

export interface FreightRateCard {
  id: string;
  tenant_id: string;
  carrier_id: string;
  service_level: string;
  status: RateCardStatus;
  label: string | null;
  effective_from: string | null;
  effective_to: string | null;
  source_upload_id: string | null;
  fuel_surcharge_percent: number | null;
  surcharges_json: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FreightRateCardLine {
  id: string;
  rate_card_id: string;
  zone_label: string;
  zone_description: string | null;
  weight_min_kg: number | null;
  weight_max_kg: number | null;
  rate_basis: RateBasis;
  rate_aud: number;
  per_kg_rate_aud: number | null;
  minimum_charge_aud: number | null;
  notes: string | null;
  created_at: string;
}
