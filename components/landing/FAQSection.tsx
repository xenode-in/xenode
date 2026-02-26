"use client";

import { useState } from "react";
import { Plus, Minus } from "lucide-react";

const faqs = [
  {
    q: "Can your team read my files?",
    a: "No. Files are encrypted on your device before upload. We hold no decryption keys — it is architecturally impossible for us to read your data.",
  },
  {
    q: "What encryption standard do you use?",
    a: "AES-256 client-side encryption with end-to-end key management. Your key is derived from your password and never transmitted in plaintext.",
  },
  {
    q: "What happens if I lose my password?",
    a: "Because we have zero knowledge of your key, recovery requires your backup recovery phrase. We cannot reset it for you — keep it safe.",
  },
  {
    q: "Is this GDPR / HIPAA compliant?",
    a: "Yes. Our zero-knowledge architecture is designed to meet GDPR and HIPAA requirements out of the box. Contact us for enterprise compliance documentation.",
  },
  {
    q: "Can I use this with existing storage tools?",
    a: "Yes. We support WebDAV, a REST API, and direct integrations with major platforms. Bring your own workflow.",
  },
];

export function FAQSection() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="relative z-10 px-6 py-24 border-b border-white/10">
      <div className="max-w-2xl mx-auto">
        <p className="text-xs uppercase tracking-widest opacity-50 mb-3">
          FAQ
        </p>
        <h2 className="text-3xl md:text-4xl font-medium leading-tight tracking-tight mb-12">
          Everything you need to know
        </h2>

        <div className="flex flex-col">
          {faqs.map((faq, i) => (
            <div key={i} className="border-b border-white/10">
              <button
                className="w-full flex items-center justify-between gap-4 py-5 text-left group"
                onClick={() => setOpen(open === i ? null : i)}
              >
                <span className="text-sm font-medium opacity-90 group-hover:opacity-100 transition-opacity">
                  {faq.q}
                </span>
                {open === i ? (
                  <Minus className="w-4 h-4 flex-shrink-0 opacity-50" />
                ) : (
                  <Plus className="w-4 h-4 flex-shrink-0 opacity-50" />
                )}
              </button>

              <div
                className={`overflow-hidden transition-all duration-200 ${
                  open === i ? "max-h-48 pb-5" : "max-h-0"
                }`}
              >
                <p className="text-sm opacity-60 leading-relaxed">{faq.a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
