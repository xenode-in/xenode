import { CreditCard, Clock } from "lucide-react";

export default function BillingPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Billing</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your subscription and billing
        </p>
      </div>

      {/* Current Plan */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-foreground">Current Plan</h3>
          <span className="text-xs font-medium text-primary bg-primary/10 px-3 py-1 rounded-full">
            Free Tier
          </span>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Storage</span>
            <span className="text-foreground">1 TB included</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Egress</span>
            <span className="text-foreground">500 GB / month</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">API Requests</span>
            <span className="text-foreground">Unlimited</span>
          </div>
        </div>
      </div>

      {/* Coming Soon */}
      <div className="bg-card border border-primary/10 rounded-xl p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
          <CreditCard className="w-6 h-6 text-primary" />
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">
          Pro Plan Coming Soon
        </h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
          We&apos;re working on paid plans with higher limits, priority support,
          and advanced features. Stay tuned!
        </p>
        <div className="inline-flex items-center gap-2 text-xs text-primary bg-primary/5 px-4 py-2 rounded-full">
          <Clock className="w-3 h-3" />
          Expected Q2 2026
        </div>
      </div>

      {/* Invoice History Placeholder */}
      <div className="bg-card border border-border rounded-xl">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm font-medium text-foreground">
            Invoice History
          </h3>
        </div>
        <div className="px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground/50">
            No invoices yet. Billing history will appear here once you upgrade.
          </p>
        </div>
      </div>
    </div>
  );
}
