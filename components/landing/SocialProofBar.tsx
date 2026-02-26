const quotes = [
  {
    text: "Finally, storage I can actually trust with client contracts.",
    author: "Priya M.",
    role: "Freelance Designer",
  },
  {
    text: "The zero-knowledge model sold our compliance team immediately.",
    author: "Arun K.",
    role: "CTO, HealthTech Startup",
  },
  {
    text: "Revokable shared links changed how we hand off deliverables.",
    author: "Sandra O.",
    role: "Product Lead",
  },
];

const trustBadges = [
  "AES-256",
  "Zero-Knowledge",
  "GDPR Ready",
  "HIPAA Aligned",
  "Open Source Core",
];

export function SocialProofBar() {
  return (
    <section className="relative z-10 px-6 py-16 border-y border-white/10 bg-white/[0.02]">
      <div className="max-w-5xl mx-auto flex flex-col gap-10">
        {/* Trust badges */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          {trustBadges.map((badge) => (
            <span
              key={badge}
              className="px-4 py-1.5 rounded-full border border-white/15 text-xs uppercase tracking-widest opacity-60 bg-white/5"
            >
              {badge}
            </span>
          ))}
        </div>

        {/* Pull-quotes */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {quotes.map((q) => (
            <div
              key={q.author}
              className="rounded-xl border border-white/10 bg-white/5 p-6 flex flex-col gap-4"
            >
              <p className="text-sm leading-relaxed opacity-80">
                &ldquo;{q.text}&rdquo;
              </p>
              <div className="mt-auto">
                <p className="text-sm font-semibold">{q.author}</p>
                <p className="text-xs opacity-40">{q.role}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-sm opacity-40">
          Trusted by early users across 12+ countries.
        </p>
      </div>
    </section>
  );
}
