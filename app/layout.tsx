import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BridgerPay International Card Velocity Tool",
  description: "Velocity, retry, fraud, risk and decline analysis for BridgerPay orchestrator CSV reports."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
