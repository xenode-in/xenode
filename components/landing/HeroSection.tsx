import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative z-10 border-b border-white/10">
      <div className="max-w-[1200px] mx-auto flex flex-col items-center justify-center text-center px-8 pt-32 pb-24">
        {/* Eyebrow badge */}
        {/* <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/20 bg-white/5 text-sm mb-8 backdrop-blur-sm">
          <ShieldCheck className="w-4 h-4 text-[#7cb686]" />
          <span className="opacity-80">
            Zero-knowledge · AES-256 · Client-side encryption
          </span>
        </div> */}

        {/* Headline */}
        <h1 className="text-5xl md:text-7xl lg:text-8xl font-medium leading-[1.05] tracking-tight mb-6 max-w-4xl">
          Your files.{" "}
          <span className="font-brand italic opacity-70">Only yours.</span>
        </h1>

        {/* Subtext */}
        <p className="text-lg md:text-xl leading-relaxed opacity-70 mb-10 max-w-[520px]">
          End-to-end encrypted cloud storage — no one, not even us, can read
          your files.
        </p>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <Button
            asChild
            className="bg-[#e8e4d9] text-[#273f2c] hover:bg-white uppercase tracking-wider font-semibold h-12 px-8 transition-all duration-200 hover:-translate-y-0.5 rounded-xl text-sm"
          >
            <Link href="/login">Start for Free</Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            className="h-12 px-6 rounded-xl opacity-70 hover:opacity-100 text-sm"
          >
            <Link href="#how-it-works">See how it works →</Link>
          </Button>
        </div>

        {/* Social micro-proof */}
        <p className="mt-8 text-sm opacity-50">
          Trusted by developers &amp; teams who take privacy seriously.
        </p>
      </div>
    </section>
  );
}
