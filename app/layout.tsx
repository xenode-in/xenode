import type { Metadata } from "next";
import localFont from "next/font/local";
import { Libre_Baskerville } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";

const suisseIntl = localFont({
  src: "../public/fonts/SuisseIntl-Regular.ttf",
  variable: "--font-suisse",
  display: "swap",
});

const libreBaskerville = Libre_Baskerville({
  weight: "400",
  style: "italic",
  subsets: ["latin"],
  variable: "--font-brand",
  display: "swap",
});

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "Xenode | Store Files. Share Securely. Stay Private.",
    template: "%s | Xenode",
  },
  description:
    "Xenode is end-to-end encrypted cloud storage built for people who value their privacy. No one, not even us, can read your files.",
  keywords: [
    "end-to-end encrypted cloud storage",
    "e2ee file storage",
    "private cloud storage",
    "secure file sharing",
    "zero knowledge storage",
    "encrypted storage india",
    "AES-256 cloud storage",
    "secure file manager",
    "encrypted object storage",
    "private file sharing",
    "xenode",
  ],
  authors: [{ name: "Xenode Team" }],
  creator: "Xenode",
  alternates: {
    canonical: BASE_URL,
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: BASE_URL,
    title: "Xenode | Store Files. Share Securely. Stay Private.",
    description:
      "Xenode is end-to-end encrypted cloud storage built for people who value their privacy. No one, not even us, can read your files.",
    siteName: "Xenode",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Xenode | End-to-End Encrypted Cloud Storage",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Xenode | Store Files. Share Securely. Stay Private.",
    description:
      "End-to-end encrypted cloud storage. No one, not even us, can read your files.",
    creator: "@xenode",
    images: ["/og-image.png"],
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
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Xenode",
    url: BASE_URL,
    logo: `${BASE_URL}/icons/android-icon-192x192.png`,
    description:
      "End-to-end encrypted cloud storage built for people who value their privacy.",
    sameAs: [],
  };

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Xenode",
    url: BASE_URL,
    description:
      "Store files, share securely, and stay private with Xenode end-to-end encrypted cloud storage.",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${BASE_URL}/blog?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(websiteJsonLd),
          }}
        />
      </head>
      <body
        className={`${suisseIntl.variable} ${libreBaskerville.variable} font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
