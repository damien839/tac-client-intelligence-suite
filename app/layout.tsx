import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import { TenantProvider } from "@/lib/tenant-context";
import { listTenants } from "@/lib/actions/tenants";
import type { Tenant } from "@/lib/db/types";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: "TAC Client Intelligence Suite",
  description: "The Aggregate Co. — Shipping Strategy, Cost Audit & Retention Modelling",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let initialTenants: Tenant[] = [];
  try {
    initialTenants = await listTenants();
  } catch {
    initialTenants = [];
  }

  return (
    <html lang="en" className="dark">
      <body className={`${poppins.variable} font-poppins bg-tac-bg text-tac-text min-h-screen`}>
        <TenantProvider initialTenants={initialTenants}>{children}</TenantProvider>
      </body>
    </html>
  );
}
