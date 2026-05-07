"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useTenant } from "@/lib/tenant-context";
import type { Tenant, TenantKind } from "@/lib/db/types";

export default function TenantSelector() {
  const { tenants, activeTenant, setActiveTenantId, addTenant } = useTenant();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<TenantKind>("prospect");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter((t) => t.name.toLowerCase().includes(q));
  }, [tenants, query]);

  const exactMatch = useMemo(
    () => tenants.some((t) => t.name.toLowerCase() === query.trim().toLowerCase()),
    [tenants, query]
  );

  const handleSelect = (t: Tenant) => {
    setActiveTenantId(t.id);
    setOpen(false);
    setQuery("");
  };

  const handleCreate = async () => {
    setError(null);
    const name = newName.trim();
    if (!name) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind: newKind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create tenant");
      addTenant(data as Tenant);
      setCreating(false);
      setOpen(false);
      setNewName("");
      setQuery("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  const startCreate = () => {
    setNewName(query.trim());
    setCreating(true);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-tac-bg-light border border-tac-border hover:border-tac-accent/50 text-sm transition-colors min-w-[180px]"
      >
        <span className="text-tac-muted text-xs uppercase tracking-wider">Tenant</span>
        <span className="text-tac-text font-medium truncate">
          {activeTenant?.name ?? "Select…"}
        </span>
        {activeTenant && (
          <span
            className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${
              activeTenant.kind === "client"
                ? "bg-tac-accent/20 text-tac-accent"
                : "bg-tac-muted/20 text-tac-muted"
            }`}
          >
            {activeTenant.kind}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-tac-bg-card border border-tac-border rounded-lg shadow-xl z-50 overflow-hidden">
          {!creating ? (
            <>
              <div className="p-2 border-b border-tac-border">
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search or type to create…"
                  className="input-field w-full text-sm py-1.5"
                />
              </div>
              <div className="max-h-64 overflow-y-auto">
                {filtered.length === 0 && (
                  <div className="px-3 py-3 text-sm text-tac-muted">No tenants match.</div>
                )}
                {filtered.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleSelect(t)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-tac-bg-light transition-colors ${
                      t.id === activeTenant?.id ? "bg-tac-accent/10" : ""
                    }`}
                  >
                    <span className="truncate text-tac-text">{t.name}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        t.kind === "client"
                          ? "bg-tac-accent/20 text-tac-accent"
                          : "bg-tac-muted/20 text-tac-muted"
                      }`}
                    >
                      {t.kind}
                    </span>
                  </button>
                ))}
              </div>
              {query.trim() && !exactMatch && (
                <button
                  type="button"
                  onClick={startCreate}
                  className="w-full px-3 py-2 text-sm text-tac-accent hover:bg-tac-accent/10 border-t border-tac-border text-left"
                >
                  + Create &ldquo;{query.trim()}&rdquo;
                </button>
              )}
            </>
          ) : (
            <div className="p-3 space-y-3">
              <div>
                <label className="block text-xs text-tac-muted mb-1">Name</label>
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="input-field w-full text-sm py-1.5"
                />
              </div>
              <div>
                <label className="block text-xs text-tac-muted mb-1">Type</label>
                <div className="flex gap-2">
                  {(["client", "prospect"] as TenantKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setNewKind(k)}
                      className={`flex-1 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                        newKind === k
                          ? "border-tac-accent bg-tac-accent/10 text-tac-accent"
                          : "border-tac-border text-tac-muted hover:text-tac-text"
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="text-xs text-tac-danger">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setError(null);
                  }}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-tac-border text-sm text-tac-muted hover:text-tac-text"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={submitting || !newName.trim()}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-tac-accent text-tac-bg text-sm font-medium disabled:opacity-50"
                >
                  {submitting ? "Creating…" : "Create"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
