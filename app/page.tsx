"use client";

import { useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle } from "lucide-react";

export default function Home() {
  const [email, setEmail] = useState("");
  const [waitlistCount, setWaitlistCount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (data.success) {
        setIsSubmitted(true);
        setMessage(data.message);
      } else {
        setMessage(data.message || "Something went wrong");
      }
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const getWaitlistCount = async () => {
    const response = await fetch("/api/waitlist");
    const data = await response.json();
    setWaitlistCount(data.count);
  };

  useEffect(() => {
    getWaitlistCount();
  }, []);

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
        style={{
          backgroundImage: "url('/grain.png')",
        }}
      />

      {/* Navigation */}
      <Navbar />

      {/* Hero Section */}
      <main className="flex-1 flex items-center justify-center p-8 relative z-10">
        <div className="max-w-[600px] text-center">
          <h1 className="text-4xl md:text-4xl lg:text-7xl font-medium leading-tight tracking-tight mb-6">
            Join <span className="font-brand italic">Xenode</span>
            <br />
            <span className="opacity-70">Waitlist Today.</span>
          </h1>

          <p className="text-lg leading-relaxed opacity-80 mb-10 max-w-[480px] mx-auto">
            Building S3 compatible object storage for developers. Simple,
            Affordable, and Optimized for India.
          </p>

          {!isSubmitted ? (
            <form
              onSubmit={handleSubmit}
              className="w-full max-w-[420px] mx-auto"
            >
              <div className="flex flex-col sm:flex-row gap-2 bg-white/10 border border-white/20 rounded-xl p-1.5 backdrop-blur-sm shadow-sm">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email address"
                  className="flex-1 py-4 bg-transparent border-none text-[#e8e4d9] placeholder:text-[#e8e4d9]/50 focus-visible:ring-0 focus-visible:ring-offset-0 h-11 shadow-none"
                  required
                />
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#e8e4d9] text-[#273f2c] hover:bg-white uppercase tracking-wider font-semibold h-11 px-6 transition-all duration-200 hover:-translate-y-0.5"
                >
                  {isSubmitting ? "Joining..." : "Join Waitlist"}
                </Button>
              </div>
            </form>
          ) : (
            <div className="inline-flex items-center justify-center gap-3 px-6 py-4 bg-white/10 border border-white/20 rounded-xl text-base shadow-sm">
              <CheckCircle className="w-5 h-5 text-[#e8e4d9]" />
              <span>
                {message || "You're on the list! We'll be in touch soon."}
              </span>
            </div>
          )}

          <p className="mt-4 text-sm opacity-80">
            Joined {100 + waitlistCount} waitlist members.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 p-8 text-center text-sm opacity-60">
        <p>
          © 2026 <span className="font-brand italic">Xenode</span>. All rights
          reserved.
        </p>
      </footer>
    </div>
  );
}
