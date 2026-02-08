import type { Metadata } from "next";
import localFont from "next/font/local";
import { Libre_Baskerville } from "next/font/google";
import "./globals.css";

const suisseIntl = localFont({
  src: "../public/fonts/SuisseIntl-Regular.ttf",
  variable: "--font-suisse",
  display: "swap",
});

// Using Libre Baskerville Italic as an elegant serif for branding
// (similar to Caslon italic style)
const libreBaskerville = Libre_Baskerville({
  weight: "400",
  style: "italic",
  subsets: ["latin"],
  variable: "--font-brand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Xenode - Build the Future",
  description:
    "Join the waitlist for Xenode, your next-generation platform for seamless development and deployment.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${suisseIntl.variable} ${libreBaskerville.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
