import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: "TAC Client Intelligence Suite",
  description: "The Aggregate Co. — Shipping Strategy, Cost Audit & Retention Modelling",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${poppins.variable} font-poppins bg-tac-bg text-tac-text min-h-screen`}>
        {children}
      </body>
    </html>
  );
}
