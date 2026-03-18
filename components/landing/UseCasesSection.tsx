import { Lock, Users } from "lucide-react";

const cases = [
  {
    tag: "Personal",
    icon: Lock,
    title: "Private Storage",
    body: "Encrypt and store personal documents, photos, and sensitive files. Zero-knowledge architecture means only your key unlocks your data.",
    bullets: [
      "Client-side AES-256 encryption before upload",
      "No plaintext ever leaves your device",
      "Secure recovery phrase — we hold no keys",
      "Access your files from any device, anytime",
    ],
  },
  {
    tag: "Teams / Business",
    icon: Users,
    title: "Secure Collaboration",
    body: "Share encrypted folders with teammates. Granular access control, audit logs, and key management — built for compliance.",
    bullets: [
      "Encrypted shared folders with role-based access",
      "Granular permission levels per file or folder",
      "Immutable audit log for every file action",
      "GDPR & HIPAA-ready out of the box",
    ],
  },
];

export function UseCasesSection() {
  return (
    <section className="relative z-10 border-b  flex justify-center px-6 md:px-8">
      <div className="w-full max-w-[1200px] py-24 px-6">
        {/* Header */}
        <p className="text-xs uppercase tracking-widest opacity-50 mb-3">
          XENODE SOLUTIONS
        </p>
        <h2 className="text-3xl md:text-5xl font-medium leading-tight tracking-tight mb-16">
          Two ways to use <span className="font-brand italic">Xenode</span>
        </h2>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {cases.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.title}
                className="rounded-xl border  bg-white/5 p-8 backdrop-blur-sm flex flex-col gap-5 hover:border-white/20 transition-colors duration-200"
              >
                <div className="flex items-start justify-between">
                  <span className="text-xs uppercase tracking-widest opacity-50 border border-white/15 rounded-full px-3 py-1">
                    {c.tag}
                  </span>
                  <Icon className="w-5 h-5 opacity-40" />
                </div>

                <div>
                  <h3 className="text-xl font-semibold mb-2">{c.title}</h3>
                  <p className="opacity-60 text-sm leading-relaxed">{c.body}</p>
                </div>

                <ul className="flex flex-col gap-2 mt-auto">
                  {c.bullets.map((b) => (
                    <li
                      key={b}
                      className="flex items-start gap-2 text-sm opacity-70"
                    >
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#7cb686] flex-shrink-0" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
