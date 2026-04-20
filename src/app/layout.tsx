import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NUMU Store",
  description: "Powered by NUMU",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
