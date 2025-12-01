import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "Sube tus fotos",
  description: "Las fotos de la boda de Carlos y Andrea",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className={`${dmSans.variable} antialiased`} style={{ fontFamily: 'var(--font-dm-sans)' }}>
        {children}

        {/* Sensores globales invisibles */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}