import { Navbar } from "@/components/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { UseCasesSection } from "@/components/landing/UseCasesSection";
import { InActionSection } from "@/components/landing/InActionSection";
import { StageTimeline } from "@/components/landing/StageTimeline";
import { SocialProofBar } from "@/components/landing/SocialProofBar";
import { FAQSection } from "@/components/landing/FAQSection";
import { LandingFooter } from "@/components/landing/LandingFooter";

export default function Home() {
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
        style={{ backgroundImage: "url('/grain.png')" }}
      />

      {/* Navigation */}
      <Navbar />

      {/* Landing Sections */}
      <HeroSection />
      <UseCasesSection />
      <InActionSection />
      <StageTimeline />
      <SocialProofBar />
      <FAQSection />
      <LandingFooter />
    </div>
  );
}
