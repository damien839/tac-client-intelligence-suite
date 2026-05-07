"use client";

interface Props {
  tenantId: string | null;
}

export default function CurrentRateCardsTab({ tenantId }: Props) {
  if (!tenantId) {
    return (
      <div className="card text-center py-12 border-dashed">
        <p className="text-tac-muted">Select a tenant to view current rate cards.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Current Rate Cards</h2>
        <button
          type="button"
          disabled
          className="px-4 py-2 rounded-lg bg-tac-accent/50 text-tac-bg text-sm font-medium opacity-60 cursor-not-allowed"
        >
          + Upload Rate Card
        </button>
      </div>
      <div className="card text-center py-12 border-dashed">
        <p className="text-tac-muted">
          Rate-card upload + Claude extraction is the next build chunk. Coming up: PDF/Excel/CSV
          ingestion, side-by-side review, and DB commit.
        </p>
      </div>
    </div>
  );
}
