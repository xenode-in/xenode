import { Suspense } from "react";
import Link from "next/link";
import { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import PricingComparison from "@/components/PricingComparison";
import { Button } from "@/components/ui/button";
import { ThemeGradientBackground } from "@/components/ThemeGradientBackground";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, transparent pricing for encrypted cloud storage. No hidden fees, no compromises on your privacy.",
  alternates: {
    canonical: `${BASE_URL}/pricing`,
  },
  openGraph: {
    type: "website",
    url: `${BASE_URL}/pricing`,
    title: "Pricing | Xenode",
    description:
      "Simple, transparent pricing for encrypted cloud storage. No hidden fees, no compromises on your privacy.",
    images: [
      {
        url: `${BASE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "Xenode Pricing — Encrypted Cloud Storage",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pricing | Xenode",
    description:
      "Simple, transparent pricing for end-to-end encrypted cloud storage.",
    images: [`${BASE_URL}/og-image.png`],
  },
};

export default function PricingPage() {
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: BASE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Pricing",
        item: `${BASE_URL}/pricing`,
      },
    ],
  };

  return (
    <div className="relative min-h-screen flex flex-col font-sans bg-background text-foreground transition-colors duration-300">
      <ThemeGradientBackground />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbJsonLd),
        }}
      />

      {/* Grain overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-20 contrast-200 bg-center bg-contain bg-fixed bg-repeat"
        style={{
          backgroundImage: "url('/grain.png')",
        }}
      />

      {/* Navigation */}
      <Navbar />

      {/* Main Content */}
      <main className="flex-1 relative z-10">
        <Suspense fallback={<div>Loading pricing...</div>}>
          <PricingComparison />
        </Suspense>
      </main>

      {/* Footer */}
      <footer className="relative z-10 p-8 text-center text-sm opacity-60">
        <p>
          © 2026 <span className="font-brand italic">Xenode</span>. All rights
          reserved.
        </p>
      </footer>
    </div>
  );
}
