"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import TenantSelector from "./TenantSelector";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/simulator", label: "Shipping Strategy" },
  { href: "/warehouse", label: "Warehouse" },
  { href: "/final-mile", label: "Final Mile" },
  { href: "/retention", label: "Retention Model" },
  { href: "/tenants", label: "Tenants" },
  { href: "/report", label: "Report" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="no-print bg-tac-bg-card border-b border-tac-border sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <span className="text-tac-accent text-lg tracking-[0.3em] font-light uppercase">
              The Aggregate Co.
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  pathname === item.href
                    ? "bg-tac-accent/10 text-tac-accent"
                    : "text-tac-muted hover:text-tac-text hover:bg-tac-bg-light"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div className="hidden md:block shrink-0">
            <TenantSelector />
          </div>

          {/* Mobile menu */}
          <div className="md:hidden flex items-center gap-2">
            <TenantSelector />
            <select
              value={pathname}
              onChange={(e) => {
                window.location.href = e.target.value;
              }}
              className="input-field text-sm py-1.5"
            >
              {navItems.map((item) => (
                <option key={item.href} value={item.href}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </nav>
  );
}
