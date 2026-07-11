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
    <section className="relative z-10 border-y border-border bg-card/35 flex justify-center px-6 md:px-8">
      <div className="w-full max-w-[1200px] py-16 px-6 flex flex-col gap-10">
        {/* Trust badges */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          {trustBadges.map((badge) => (
            <span
              key={badge}
              className="px-4 py-1.5 rounded-full border border-border bg-muted/70 text-muted-foreground text-xs uppercase tracking-widest"
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
              className="rounded-xl border border-border bg-card/85 p-6 flex flex-col gap-4"
            >
              <p className="text-sm leading-relaxed text-muted-foreground">
                &ldquo;{q.text}&rdquo;
              </p>
              <div className="mt-auto">
                <p className="text-sm font-semibold">{q.author}</p>
                <p className="text-xs text-muted-foreground">{q.role}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Trusted by early users across 12+ countries.
        </p>
      </div>
    </section>
  );
}
