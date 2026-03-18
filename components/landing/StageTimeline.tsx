const stages = [
  {
    name: "Free",
    tagline: "5 GB, zero-knowledge storage",
    note: "Forever free",
  },
  {
    name: "Pro",
    tagline: "100 GB + priority support",
    note: "Individual power users",
  },
  {
    name: "Teams",
    tagline: "1 TB shared + audit logs",
    note: "Small & mid-size teams",
  },
  {
    name: "Enterprise",
    tagline: "Unlimited + compliance tools",
    note: "Custom SLA & key management",
  },
];

export function StageTimeline() {
  return (
    <section className="relative z-10 border-b  flex justify-center px-6 md:px-8">
      <div className="w-full max-w-[1200px] py-16 px-6">
        <p className="text-xs uppercase tracking-widest opacity-50 mb-8 text-center">
          EVERY STAGE OF YOUR JOURNEY
        </p>

        {/* Timeline strip */}
        <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-white/10 border  rounded-xl overflow-hidden">
          {stages.map((stage, i) => (
            <div
              key={stage.name}
              className={`flex-1 px-6 py-6 flex flex-col gap-1.5 ${
                i === 0
                  ? "bg-white/10"
                  : "bg-white/[0.03] hover:bg-white/[0.06]"
              } transition-colors duration-150`}
            >
              <span className="text-xs uppercase tracking-widest opacity-50 font-mono">
                {i === 0 ? "▶ " : ""}
                {stage.name}
              </span>
              <span className="text-sm font-medium leading-snug">
                {stage.tagline}
              </span>
              <span className="text-xs opacity-40 mt-1">{stage.note}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
