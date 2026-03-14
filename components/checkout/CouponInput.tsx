"use client";

import { useState } from "react";
import { Tag, X, CheckCircle } from "lucide-react";

interface CouponResult {
  couponId: string;
  code: string;
  discountAmount: number;
  discountLabel: string;
}

interface CouponInputProps {
  planSlug: string;
  planPriceINR: number;
  onApply: (result: CouponResult | null) => void;
  applied: CouponResult | null;
}

export default function CouponInput({ planSlug, planPriceINR, onApply, applied }: CouponInputProps) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/coupons/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim(), planSlug, planPriceINR }),
    });
    const data = await res.json();
    setLoading(false);
    if (data.valid) {
      onApply({
        couponId: data.couponId,
        code: data.code,
        discountAmount: data.discountAmount,
        discountLabel: data.discountLabel,
      });
      setCode("");
      setError(null);
    } else {
      setError(data.error || "Invalid coupon");
      onApply(null);
    }
  }

  function remove() {
    onApply(null);
    setCode("");
    setError(null);
  }

  // Applied state
  if (applied) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <div>
            <span className="font-mono text-sm font-semibold text-emerald-400">{applied.code}</span>
            <span className="ml-2 text-xs text-emerald-500">— {applied.discountLabel} applied</span>
          </div>
        </div>
        <button onClick={remove} className="text-zinc-500 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            placeholder="Enter coupon code"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono uppercase"
          />
        </div>
        <button
          onClick={apply}
          disabled={loading || !code.trim()}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          {loading ? (
            <span className="h-4 w-4 inline-block animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
          ) : (
            "Apply"
          )}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
