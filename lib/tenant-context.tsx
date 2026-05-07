"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Tenant } from "@/lib/db/types";

const STORAGE_KEY = "tac-cis-active-tenant";

interface TenantContextValue {
  tenants: Tenant[];
  activeTenantId: string | null;
  activeTenant: Tenant | null;
  setActiveTenantId: (id: string | null) => void;
  addTenant: (tenant: Tenant) => void;
  refresh: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue | null>(null);

interface TenantProviderProps {
  initialTenants: Tenant[];
  children: ReactNode;
}

export function TenantProvider({ initialTenants, children }: TenantProviderProps) {
  const [tenants, setTenants] = useState<Tenant[]>(initialTenants);
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && tenants.some((t) => t.id === stored)) {
      setActiveTenantIdState(stored);
    } else if (tenants.length > 0) {
      setActiveTenantIdState(tenants[0].id);
    }
  }, [tenants]);

  const setActiveTenantId = useCallback((id: string | null) => {
    setActiveTenantIdState(id);
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const addTenant = useCallback((tenant: Tenant) => {
    setTenants((prev) => {
      const next = [...prev.filter((t) => t.id !== tenant.id), tenant];
      next.sort((a, b) => a.name.localeCompare(b.name));
      return next;
    });
    setActiveTenantIdState(tenant.id);
    localStorage.setItem(STORAGE_KEY, tenant.id);
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/tenants", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as Tenant[];
    setTenants(data);
  }, []);

  const activeTenant = useMemo(
    () => tenants.find((t) => t.id === activeTenantId) ?? null,
    [tenants, activeTenantId]
  );

  const value = useMemo(
    () => ({
      tenants,
      activeTenantId,
      activeTenant,
      setActiveTenantId,
      addTenant,
      refresh,
    }),
    [tenants, activeTenantId, activeTenant, setActiveTenantId, addTenant, refresh]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenant must be used within a TenantProvider");
  }
  return ctx;
}
