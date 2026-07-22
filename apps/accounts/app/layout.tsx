import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Xenode Account",
  description: "Identity, security, connected accounts, organizations, and usage",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
