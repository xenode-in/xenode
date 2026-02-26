"use client";

import { useState } from "react";
import { FileText, Share2, ShieldCheck } from "lucide-react";

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

export function InActionSection() {
  const [active, setActive] = useState(0);
  const scenario = scenarios[active];
  const Icon = scenario.icon;

  return (
    <section
      id="how-it-works"
      className="relative z-10 px-6 py-24 border-b border-white/10"
    >
      <div className="max-w-5xl mx-auto">
        <p className="text-xs uppercase tracking-widest opacity-50 mb-3">
          XENODE IN ACTION
        </p>
        <h2 className="text-3xl md:text-5xl font-medium leading-tight tracking-tight mb-4">
          Three situations where{" "}
          <span className="font-brand italic">Xenode</span> helps
        </h2>
        <p className="opacity-60 mb-14 text-sm max-w-xl">
          Common real-world scenarios. Don't see yours? There are many more.
        </p>

        <div className="flex flex-col md:flex-row gap-6">
          {/* Sidebar nav */}
          <div className="flex flex-row md:flex-col gap-2 md:w-56 flex-shrink-0">
            {scenarios.map((s, i) => (
              <button
                key={s.num}
                onClick={() => setActive(i)}
                className={`flex items-center gap-3 text-left px-4 py-3 rounded-lg transition-all duration-150 text-sm ${
                  active === i
                    ? "bg-white/10 border border-white/20 font-medium"
                    : "opacity-50 hover:opacity-80"
                }`}
              >
                <span className="font-mono text-xs opacity-60">{s.num}</span>
                <span className="leading-snug">{s.title}</span>
              </button>
            ))}
          </div>

          {/* Detail card */}
          <div className="flex-1 rounded-xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm">
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
                  <span className="flex-shrink-0 w-6 h-6 rounded-full border border-white/20 flex items-center justify-center text-xs font-mono opacity-60">
                    {i + 1}
                  </span>
                  <span className="opacity-80 text-sm leading-relaxed pt-0.5">
                    {step}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
