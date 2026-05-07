"use client";

import { useEffect, useState } from "react";

interface ZoneStats {
  total: number;
  by_ap_base_zone: Record<string, number>;
  source_file: string | null;
  last_imported_at: string | null;
}

export default function ZoneReferenceBanner() {
  const [stats, setStats] = useState<ZoneStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/postcode-zones?stats=1", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setStats(data as ZoneStats);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Lookup failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return null;
  if (!stats) return null;

  const breakdown = Object.entries(stats.by_ap_base_zone)
    .map(([zone, count]) => `${count.toLocaleString()} ${zone.toLowerCase()}`)
    .join(" · ");

  const importedAt = stats.last_imported_at
    ? new Date(stats.last_imported_at).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "unknown";

  return (
    <div className="rounded border border-tac-border bg-tac-bg-light/30 px-3 py-2 text-xs text-tac-muted mb-6">
      <span className="text-tac-text font-medium">Zone reference loaded:</span>{" "}
      {stats.total.toLocaleString()} AU postcodes ({breakdown}) ·{" "}
      <span title={stats.source_file ?? ""}>last import {importedAt}</span> ·{" "}
      AP Base, AP Z40, AP Z9/Z6, Toll, DHL zones available for lookup
    </div>
  );
}
