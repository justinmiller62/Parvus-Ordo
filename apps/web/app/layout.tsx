import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { getBrand } from "@/src/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: "Parvus Ordo",
  description: "Many small things, rightly ordered.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const brand = await getBrand();

  // Per-request brand cascade applied as CSS variables on <html>. Per-parish /
  // diocese overrides flow automatically once resolveBrand returns them.
  const brandVars: Record<string, string> = {
    "--po-burgundy": brand.colors.burgundy,
    "--po-gold": brand.colors.gold,
    "--po-navy": brand.colors.navy,
    "--po-cream": brand.colors.cream,
    "--po-parchment": brand.colors.parchment,
    "--po-rose": brand.colors.rose,
  };

  return (
    <html lang="en" style={brandVars as CSSProperties}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
