"use client";

import CsvUploader from "@/components/shared/CsvUploader";
import { OrderRow } from "@/lib/shipping-sim/types";
import { formatNumber } from "@/lib/calculations";

interface StepUploadProps {
  orders: OrderRow[];
  errors: string[];
  warnings: string[];
  onUpload: (csvText: string) => void;
}

export default function StepUpload({ orders, errors, warnings, onUpload }: StepUploadProps) {
  return (
    <div>
      <p className="text-tac-muted mb-4">
        Upload a Shopify orders export. We need three columns: gross sale (Total), shipping paid
        (Shipping), and the service selected at checkout (Shipping Method).
      </p>
      <CsvUploader
        label="Upload Shopify Orders CSV"
        description="Required: Total, Shipping, Shipping Method"
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
    </div>
  );
}
