import { Suspense } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import PricingComparison from "@/components/PricingComparison";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Pricing | Xenode",
  description:
    "Simple, transparent pricing for our End-to-End Encrypted (E2EE) platform.",
};

export default function PricingPage() {
  return (
    <div
      className="relative min-h-screen flex flex-col text-[#e8e4d9] font-sans force-dark"
      style={{
        background: "linear-gradient(268deg, #295d32 4.2%, #273f2c 98.63%)",
      }}
    >
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

        {/* CTA Section */}
        <section className="px-8 pb-20">
          <div className="max-w-[600px] mx-auto text-center">
            <h3 className="text-2xl md:text-3xl font-semibold mb-4 text-[#e8e4d9]">
              Ready to secure your data?
            </h3>

            <Link href="/">
              <Button className="bg-[#e8e4d9] text-[#273f2c] hover:bg-white uppercase tracking-wider font-semibold h-12 px-8 text-base transition-all duration-200 hover:-translate-y-0.5">
                Join Waitlist Now
              </Button>
            </Link>
          </div>
        </section>
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
