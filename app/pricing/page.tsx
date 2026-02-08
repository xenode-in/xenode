import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PricingComparison from "@/components/PricingComparison";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Pricing | Xenode",
  description:
    "Simple, transparent pricing for S3-compatible object storage. Up to 10× cheaper than traditional cloud providers.",
};

export default function PricingPage() {
  return (
    <div
      className="relative min-h-screen flex flex-col text-[#e8e4d9] font-sans"
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
      <nav className="relative z-10 px-8 py-6">
        <div className="max-w-[1200px] mx-auto flex justify-between items-center">
          <Link
            href="/"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <span className="text-3xl font-brand italic">Xenode</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/blog"
              className="text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
            >
              Blog
            </Link>
            <Link
              href="/"
              className="flex items-center gap-2 text-sm opacity-70 hover:opacity-100 transition-opacity"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Link>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 relative z-10">
        <PricingComparison />

        {/* CTA Section */}
        <section className="px-8 pb-20">
          <div className="max-w-[600px] mx-auto text-center">
            <h3 className="text-2xl md:text-3xl font-semibold mb-4 text-[#e8e4d9]">
              Ready to save on cloud storage?
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
