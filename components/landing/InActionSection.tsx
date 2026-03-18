"use client";

import { useState, useRef, useEffect } from "react";
import { FileText, Share2, ShieldCheck, LucideIcon } from "lucide-react";
import { useInView } from "framer-motion";

const scenarios = [
  {
    num: "01",
    tag: "PROTECT",
    icon: FileText,
    title: "Protect sensitive documents",
    steps: [
      "User uploads a confidential contract",
      "Files are encrypted client-side before upload",
      "Even if our servers are breached, data is unreadable",
      "Access logs show exactly who opened what and when",
    ],
  },
  {
    num: "02",
    tag: "SHARE",
    icon: Share2,
    title: "Share without exposing",
    steps: [
      "User shares an encrypted folder with a colleague",
      "Colleague receives a secure invite link",
      "No plaintext data is ever transmitted",
      "Revoke access instantly with one click",
    ],
  },
  {
    num: "03",
    tag: "COMPLY",
    icon: ShieldCheck,
    title: "Stay compliant",
    steps: [
      "Team needs GDPR/HIPAA-compliant file storage",
      "Admin sets role-based encryption policies",
      "Audit trail auto-generated for every file action",
      "Export compliance reports in one click",
    ],
  },
];

type Scenario = (typeof scenarios)[0];

function ScenarioCard({
  scenario,
  index,
  setActive,
}: {
  scenario: Scenario;
  index: number;
  setActive: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Trigger when card is in the center of the screen
  const isInView = useInView(ref, { margin: "-45% 0px -45% 0px" });

  useEffect(() => {
    if (isInView) {
      setActive(index);
    }
  }, [isInView, index, setActive]);

  const Icon = scenario.icon as LucideIcon;

  return (
    <div
      ref={ref}
      id={`scenario-${index}`}
      className="rounded-xl border  bg-white/5 p-8 backdrop-blur-sm transition-all duration-500 min-h-[350px] flex flex-col justify-center"
      style={{
        opacity: isInView ? 1 : 0.3,
        transform: isInView ? "scale(1)" : "scale(0.95)",
      }}
    >
      <div className="flex items-center gap-3 mb-6">
        <span className="text-xs uppercase tracking-widest opacity-50 border border-white/15 rounded-full px-3 py-1">
          {scenario.tag}
        </span>
        <Icon className="w-4 h-4 opacity-40" />
      </div>

      <h3 className="text-xl font-semibold mb-6">{scenario.title}</h3>

      <ul className="flex flex-col gap-4">
        {scenario.steps.map((step, i) => (
          <li key={i} className="flex items-start gap-4">
            <span className="shrink-0 w-6 h-6 rounded-full border border-white/20 flex items-center justify-center text-xs font-mono opacity-60">
              {i + 1}
            </span>
            <span className="opacity-80 text-sm leading-relaxed pt-0.5">
              {step}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function InActionSection() {
  const [active, setActive] = useState(0);

  const scrollTo = (index: number) => {
    setActive(index);
    const element = document.getElementById(`scenario-${index}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <section
      id="how-it-works"
      className="relative z-10 border-b  flex justify-center px-6 md:px-8"
    >
      <div className="w-full max-w-[1200px] py-20 px-0 md:px-6 flex flex-col md:flex-row gap-12 relative items-start">
        {/* Left Sidebar (Sticky) */}
        <div className="w-full px-6 md:px-0 md:w-5/12 shrink-0 md:sticky md:top-32 min-w-0">
          <div className="flex flex-col gap-6 w-full">
            <div>
              <p className="text-xs uppercase tracking-widest opacity-50 mb-3">
                XENODE IN ACTION
              </p>
              <h2 className="text-3xl md:text-5xl font-medium leading-tight tracking-tight mb-4">
                Three situations where{" "}
                <span className="font-brand italic">Xenode</span> helps
              </h2>
              <p className="opacity-60 mb-8 text-sm max-w-sm">
                Common real-world scenarios. Don't see yours? There are many
                more.
              </p>
            </div>

            <div className="flex flex-row overflow-x-auto pb-4 md:pb-0 md:overflow-visible md:flex-col gap-2 w-full snap-x snap-mandatory">
              {scenarios.map((s, i) => (
                <button
                  key={s.num}
                  onClick={() => scrollTo(i)}
                  className={`shrink-0 snap-start flex items-center gap-3 text-left px-4 py-3 rounded-lg transition-all duration-300 text-sm whitespace-nowrap md:whitespace-normal ${
                    active === i
                      ? "bg-white/10 border border-white/20 font-medium scale-[1.02] origin-left"
                      : "opacity-50 hover:opacity-80"
                  }`}
                >
                  <span className="font-mono text-xs opacity-60">{s.num}</span>
                  <span className="leading-snug">{s.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Content (Scrollable) */}
        <div className="w-full px-6 md:px-0 md:w-7/12 flex flex-col gap-8 md:gap-32 md:py-[10vh] min-w-0">
          {scenarios.map((scenario, index) => (
            <ScenarioCard
              key={scenario.num}
              scenario={scenario}
              index={index}
              setActive={setActive}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
