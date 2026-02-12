import { CreditCard, Clock } from "lucide-react";

export default function BillingPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[#e8e4d9]">Billing</h1>
        <p className="text-sm text-[#e8e4d9]/50 mt-1">
          Manage your subscription and billing
        </p>
      </div>

      {/* Current Plan */}
      <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-[#e8e4d9]">Current Plan</h3>
          <span className="text-xs font-medium text-[#7cb686] bg-[#7cb686]/10 px-3 py-1 rounded-full">
            Free Tier
          </span>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#e8e4d9]/60">Storage</span>
            <span className="text-[#e8e4d9]">1 TB included</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#e8e4d9]/60">Egress</span>
            <span className="text-[#e8e4d9]">500 GB / month</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#e8e4d9]/60">API Requests</span>
            <span className="text-[#e8e4d9]">Unlimited</span>
          </div>
        </div>
      </div>

      {/* Coming Soon */}
      <div className="bg-[#1a2e1d]/50 border border-[#7cb686]/10 rounded-xl p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#7cb686]/10 mb-4">
          <CreditCard className="w-6 h-6 text-[#7cb686]" />
        </div>
        <h3 className="text-lg font-medium text-[#e8e4d9] mb-2">
          Pro Plan Coming Soon
        </h3>
        <p className="text-sm text-[#e8e4d9]/50 max-w-md mx-auto mb-4">
          We&apos;re working on paid plans with higher limits, priority support,
          and advanced features. Stay tuned!
        </p>
        <div className="inline-flex items-center gap-2 text-xs text-[#7cb686] bg-[#7cb686]/5 px-4 py-2 rounded-full">
          <Clock className="w-3 h-3" />
          Expected Q2 2026
        </div>
      </div>

      {/* Invoice History Placeholder */}
      <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl">
        <div className="px-6 py-4 border-b border-white/5">
          <h3 className="text-sm font-medium text-[#e8e4d9]">
            Invoice History
          </h3>
        </div>
        <div className="px-6 py-12 text-center">
          <p className="text-sm text-[#e8e4d9]/30">
            No invoices yet. Billing history will appear here once you upgrade.
          </p>
        </div>
      </div>
    </div>
  );
}
