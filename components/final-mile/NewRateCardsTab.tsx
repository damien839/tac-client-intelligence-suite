"use client";

interface Props {
  tenantId: string | null;
}

export default function NewRateCardsTab({ tenantId }: Props) {
  if (!tenantId) {
    return (
      <div className="card text-center py-12 border-dashed">
        <p className="text-tac-muted">Select a tenant to upload new rate cards.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">New Rate Cards</h2>
      </div>
      <div className="card text-center py-12 border-dashed">
        <p className="text-tac-muted">
          Drop a new rate card here once Claude extraction is wired up. New cards will be staged for
          review and then promoted to compare against the current set.
        </p>
      </div>
    </div>
  );
}
