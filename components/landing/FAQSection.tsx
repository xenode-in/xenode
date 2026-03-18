"use client";

import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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
    <section className="relative z-10 border-b  flex justify-center px-6 md:px-8">
      <div className="w-full max-w-[1200px] py-24 px-6 flex justify-center">
        <div className="w-full max-w-2xl">
          <p className="text-xs uppercase tracking-widest opacity-50 mb-3">
            FAQ
          </p>
          <h2 className="text-3xl md:text-4xl font-medium leading-tight tracking-tight mb-12">
            Everything you need to know
          </h2>

          <div className="flex flex-col">
            {faqs.map((faq, i) => (
              <div key={i} className="border-b ">
                <button
                  className="w-full flex items-center justify-between gap-4 py-5 text-left group"
                  onClick={() => setOpen(open === i ? null : i)}
                >
                  <span className="text-sm font-medium opacity-90 group-hover:opacity-100 transition-opacity">
                    {faq.q}
                  </span>
                  {open === i ? (
                    <Minus className="w-4 h-4 shrink-0 opacity-50" />
                  ) : (
                    <Plus className="w-4 h-4 shrink-0 opacity-50" />
                  )}
                </button>

                <AnimatePresence>
                  {open === i && (
                    <motion.div
                      initial={{ height: 0, opacity: 0, filter: "blur(4px)" }}
                      animate={{
                        height: "auto",
                        opacity: 1,
                        filter: "blur(0px)",
                      }}
                      exit={{ height: 0, opacity: 0, filter: "blur(4px)" }}
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <p className="text-sm opacity-60 leading-relaxed pb-5">
                        {faq.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
