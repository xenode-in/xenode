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
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  ),
  title: {
    default: "Xenode - S3 Compatible Object Storage for India",
    template: "%s | Xenode",
  },
  description:
    "S3-compatible object storage optimized for Indian developers. Simple pricing, local infrastructure, and developer first experience.",
  keywords: [
    "object storage",
    "s3 compatible",
    "cloud storage india",
    "developer tools",
    "infrastructure",
    "xenode",
  ],
  authors: [{ name: "Xenode Team" }],
  creator: "Xenode",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    title: "Xenode - S3 Compatible Object Storage for India",
    description:
      "S3-compatible object storage optimized for Indian developers. Simple pricing, local infrastructure, and developer first experience.",
    siteName: "Xenode",
    images: [
      {
        url: "/icons/apple-icon-180x180.png",
        width: 180,
        height: 180,
        alt: "Xenode - Object Storage for India",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Xenode - S3 Compatible Object Storage for India",
    description:
      "High-performance, S3-compatible object storage optimized for Indian developers.",
    creator: "@xenode",
    images: ["/icons/apple-icon-180x180.png"],
  },
  icons: {
    icon: [
      { url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-96x96.png", sizes: "96x96", type: "image/png" },
    ],
    shortcut: "/icons/favicon.ico",
    apple: [
      { url: "/icons/apple-icon-57x57.png", sizes: "57x57", type: "image/png" },
      { url: "/icons/apple-icon-60x60.png", sizes: "60x60", type: "image/png" },
      { url: "/icons/apple-icon-72x72.png", sizes: "72x72", type: "image/png" },
      { url: "/icons/apple-icon-76x76.png", sizes: "76x76", type: "image/png" },
      {
        url: "/icons/apple-icon-114x114.png",
        sizes: "114x114",
        type: "image/png",
      },
      {
        url: "/icons/apple-icon-120x120.png",
        sizes: "120x120",
        type: "image/png",
      },
      {
        url: "/icons/apple-icon-144x144.png",
        sizes: "144x144",
        type: "image/png",
      },
      {
        url: "/icons/apple-icon-152x152.png",
        sizes: "152x152",
        type: "image/png",
      },
      {
        url: "/icons/apple-icon-180x180.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    other: [
      {
        rel: "icon",
        url: "/icons/android-icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
  },
  manifest: "/icons/manifest.json",
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
