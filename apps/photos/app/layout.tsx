import type { ReactNode } from "react";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider, Toaster } from "@xenode/ui";
import "./globals.css";

const suisseIntl = localFont({
  src: "../public/fonts/SuisseIntl-Regular.ttf",
  variable: "--font-suisse",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Xenode Photos",
  description: "Private, end-to-end encrypted photos",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${suisseIntl.variable} font-sans antialiased`}
      >
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
