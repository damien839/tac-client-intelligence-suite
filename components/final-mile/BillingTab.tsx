"use client";

interface Props {
  tenantId: string | null;
}

export default function BillingTab({ tenantId }: Props) {
  return (
    <div className="card text-center py-12 border-dashed">
      <p className="text-tac-muted mb-2">
        Billing reports — phase 2.
      </p>
      <p className="text-xs text-tac-muted">
        Once rate-card ingestion is solid, we&apos;ll add carrier billing extraction here so you can
        reconcile charged vs contracted rates.
      </p>
      {tenantId && (
        <p className="text-[10px] text-tac-muted mt-4">Tenant scoped: {tenantId.slice(0, 8)}…</p>
      )}
    </div>
  );
}
