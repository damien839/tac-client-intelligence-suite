"use client";

import CsvUploader from "@/components/shared/CsvUploader";
import { OrderRow } from "@/lib/shipping-sim/types";
import { formatNumber } from "@/lib/calculations";

interface StepUploadProps {
  orders: OrderRow[];
  errors: string[];
  warnings: string[];
  /** True when the parser found usable line-item data (full Shopify export). */
  unitStatsDetected: boolean;
  onUpload: (csvText: string) => void;
}

export default function StepUpload({
  orders,
  errors,
  warnings,
  unitStatsDetected,
  onUpload,
}: StepUploadProps) {
  return (
    <div>
      <p className="text-tac-muted mb-4">
        Upload a Shopify orders export — the full export is recommended (include line items to
        unlock unit-driven recommendations). At minimum we need three columns: gross sale (Total),
        shipping paid (Shipping), and the service selected at checkout (Shipping Method).
      </p>
      <div className="mb-4 p-3 rounded-lg border border-tac-accent/30 bg-tac-accent/5 text-sm text-tac-text">
        <strong>One market at a time.</strong> Upload orders for a single country/region that shares
        the same currency and shipping policy. Mixing currencies or markets will skew the analysis.
        Amounts are treated as AUD.
      </div>
      <CsvUploader
        label="Upload Shopify Orders CSV"
        description="Required: Total, Shipping, Shipping Method · Full export with Lineitem quantity + price recommended"
        onUpload={(text) => onUpload(text)}
      />
      {errors.map((e, i) => (
        <p key={i} className="text-sm text-tac-danger mt-2">{e}</p>
      ))}
      {warnings.map((w, i) => (
        <p key={i} className="text-sm text-tac-warning mt-2">{w}</p>
      ))}
      {orders.length > 0 && (
        <p className="text-sm text-tac-success mt-3">✓ {formatNumber(orders.length)} orders loaded</p>
      )}
      {orders.length > 0 && unitStatsDetected && (
        <p className="text-sm text-tac-success mt-1">
          ✓ line items detected — unit-driven analysis on
        </p>
      )}
    </div>
  );
}
