import { Navbar } from "@/components/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { UseCasesSection } from "@/components/landing/UseCasesSection";
import { InActionSection } from "@/components/landing/InActionSection";
import { StageTimeline } from "@/components/landing/StageTimeline";
import { SocialProofBar } from "@/components/landing/SocialProofBar";
import { FAQSection } from "@/components/landing/FAQSection";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { SmoothScrollWrapper } from "@/components/SmoothScrollWrapper";
import { ThemeGradientBackground } from "@/components/ThemeGradientBackground";

export default function Home() {
  return (
    <SmoothScrollWrapper>
      <div className="relative min-h-[150vh] flex flex-col font-sans bg-background text-foreground transition-colors duration-300">
        <ThemeGradientBackground />
        {/* Grid Lines Overlay */}
        <div className="fixed inset-0 pointer-events-none z-60 flex justify-center px-6 md:px-8">
          <div className="w-full max-w-[1200px] border-x border-white/10 h-full" />
        </div>

        {/* Grain overlay */}
        <div
          className="fixed inset-0 pointer-events-none z-20 contrast-200 bg-center bg-contain bg-fixed bg-repeat opacity-75"
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
    </SmoothScrollWrapper>
  );
}
