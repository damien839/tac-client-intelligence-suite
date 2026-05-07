"use client";

import { useEffect, useState } from "react";

interface ZoneStats {
  total: number;
  by_ap_base_zone: Record<string, number>;
  source_file: string | null;
  last_imported_at: string | null;
}

interface CoverageStats {
  total_rows: number;
  by_carrier: Array<{
    carrier_code: string;
    service_code: string;
    postcode_count: number;
  }>;
  source: string | null;
  last_imported_at: string | null;
}

const SERVICE_LABEL: Record<string, string> = {
  STANDARD: "std",
  EXPRESS: "exp",
  SAME_DAY: "sd",
  INTERNATIONAL: "intl",
  INTL_DIRECT_STD: "intl-std",
  INTL_DIRECT_EXP: "intl-exp",
  INTL_PACKET: "intl-pkt",
};

const CARRIER_LABEL: Record<string, string> = {
  AUSPOST: "Auspost",
  ARAMEX: "Aramex",
  ARAMEX_STANDARD: "Aramex",
  TGE: "TGE",
  SEKO: "SEKO",
  PARCEL_RIGHT: "Parcel Right",
  STARTRACK: "StarTrack",
  DHL_EXPRESS: "DHL Express",
  DHL_ECOM: "DHL eCom",
};

export default function ZoneReferenceBanner() {
  const [stats, setStats] = useState<ZoneStats | null>(null);
  const [coverage, setCoverage] = useState<CoverageStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/postcode-zones?stats=1", { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error(`zones HTTP ${r.status}`);
        return r.json() as Promise<ZoneStats>;
      }),
      fetch("/api/carrier-coverage?stats=1", { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error(`coverage HTTP ${r.status}`);
        return r.json() as Promise<CoverageStats>;
      }),
    ])
      .then(([zoneStats, coverageStats]) => {
        if (cancelled) return;
        setStats(zoneStats);
        setCoverage(coverageStats);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Lookup failed");
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

  const coverageImportedAt = coverage?.last_imported_at
    ? new Date(coverage.last_imported_at).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div className="rounded border border-tac-border bg-tac-bg-light/30 px-3 py-2 text-xs text-tac-muted mb-6 space-y-1">
      <div>
        <span className="text-tac-text font-medium">Zone reference:</span>{" "}
        {stats.total.toLocaleString()} AU postcodes ({breakdown}) ·{" "}
        <span title={stats.source_file ?? ""}>last import {importedAt}</span> ·{" "}
        AP Base, AP Z40, AP Z9/Z6, Toll, DHL zones available
      </div>
      {coverage && coverage.total_rows > 0 && (
        <div>
          <span className="text-tac-text font-medium">Carrier coverage:</span>{" "}
          {formatCarrierBreakdown(coverage)}
          {coverageImportedAt && (
            <>
              {" "}
              · synced {coverageImportedAt}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatCarrierBreakdown(coverage: CoverageStats): string {
  return coverage.by_carrier
    .map((row) => {
      const carrier = CARRIER_LABEL[row.carrier_code] ?? row.carrier_code;
      const service = SERVICE_LABEL[row.service_code] ?? row.service_code.toLowerCase();
      return `${carrier} ${service} ${row.postcode_count.toLocaleString()}`;
    })
    .join(" · ");
}
