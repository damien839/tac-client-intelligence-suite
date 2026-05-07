"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  Carrier,
  FreightRateCardWithDetails,
  RateCardStatus,
} from "@/lib/db/types";
import RateCardUploader from "./RateCardUploader";
import RateCardCard from "./RateCardCard";

interface RateCardManagerProps {
  tenantId: string | null;
  status: RateCardStatus;
  emptyHint: string;
}

export default function RateCardManager({
  tenantId,
  status,
  emptyHint,
}: RateCardManagerProps) {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [cards, setCards] = useState<FreightRateCardWithDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const [carriersRes, cardsRes] = await Promise.all([
        fetch("/api/carriers", { cache: "no-store" }),
        fetch(`/api/rate-cards?tenant_id=${tenantId}&status=${status}`, {
          cache: "no-store",
        }),
      ]);
      if (!carriersRes.ok) throw new Error("Failed to load carriers");
      if (!cardsRes.ok) throw new Error("Failed to load rate cards");
      setCarriers(await carriersRes.json());
      setCards(await cardsRes.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [tenantId, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!tenantId) {
    return (
      <div className="card text-center py-12 border-dashed">
        <p className="text-tac-muted">Select a tenant to manage rate cards.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">
            {status === "current" ? "Current rate cards" : "New / proposed rate cards"}
          </h2>
          <p className="text-sm text-tac-muted mt-0.5">
            {cards.length} card{cards.length === 1 ? "" : "s"} · upload, edit, and annotate freely
          </p>
        </div>
        {tenantId && (
          <RateCardUploader
            tenantId={tenantId}
            status={status}
            carriers={carriers}
            onCreated={refresh}
          />
        )}
      </div>

      {error && (
        <div className="rounded border border-tac-danger/40 bg-tac-danger/10 px-3 py-2 text-sm text-tac-danger">
          {error}
        </div>
      )}

      {loading && cards.length === 0 ? (
        <div className="card text-sm text-tac-muted">Loading rate cards…</div>
      ) : cards.length === 0 ? (
        <div className="card text-center py-10 border-dashed">
          <p className="text-tac-muted text-sm">{emptyHint}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {cards.map((c) => (
            <RateCardCard key={c.id} card={c} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
