import UpgradePlanModal from "@/components/dashboard/UpgradePlanModal";
import RefundButton from "@/components/dashboard/RefundButton";
import { FileText } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import Payment from "@/models/Payment";

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  free: "Free Tier",
  basic: "Basic Plan",
  pro: "Pro Plan",
  plus: "Plus Plan",
  max: "Max Plan",
  enterprise: "Enterprise",
};

export default async function BillingPage() {
  const session = await getServerSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let usage: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payments: any[] = [];

  if (session?.user?.id) {
    await dbConnect();
    [usage, payments] = await Promise.all([
      Usage.findOne({ userId: session.user.id }),
      Payment.find({ userId: session.user.id }).sort({ createdAt: -1 }).lean(),
    ]);
  }

  const isPaidPlan = usage?.plan && usage.plan !== "free";
  const planName = usage?.plan
    ? PLAN_DISPLAY_NAMES[usage.plan] || usage.plan.charAt(0).toUpperCase() + usage.plan.slice(1) + " Plan"
    : "Free Tier";

  const storageLimit = usage?.storageLimitBytes
    ? formatBytes(usage.storageLimitBytes)
    : "1 TB";
  const egressLimit = usage?.egressLimitBytes
    ? formatBytes(usage.egressLimitBytes)
    : "500 GB";

  const formatDate = (date: Date | null | undefined) => {
    if (!date) return null;
    return new Date(date).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const planActivatedDate = formatDate(usage?.planActivatedAt);
  const planExpiryDate = formatDate(usage?.planExpiresAt);

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Billing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your subscription and billing
          </p>
        </div>

        <div>
          <UpgradePlanModal />
        </div>
      </div>

      {/* ── Current Plan ── */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-foreground">Current Plan</h3>
          <span
            className={`text-xs font-medium px-3 py-1 rounded-full border ${
              isPaidPlan
                ? "bg-primary/10 text-primary border-primary/20"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {planName}
          </span>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Storage Limit</span>
            <span className="text-foreground">{storageLimit} included</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Egress Limit</span>
            <span className="text-foreground">{egressLimit} / month</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">API Requests</span>
            <span className="text-foreground">Unlimited</span>
          </div>
          {isPaidPlan && planActivatedDate && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Plan Started</span>
                <span className="text-foreground">{planActivatedDate}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Renews On</span>
                <span className="text-foreground">{planExpiryDate}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Invoice History ── */}
      <div>
        <h3 className="text-lg font-medium text-foreground mb-4">
          Invoice History
        </h3>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {payments.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                No invoices yet. Billing history will appear here once you
                upgrade.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="border-b border-border">
                  <tr>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Date
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Amount
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Status
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Plan
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">
                      Receipt
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payments.map((payment) => (
                    <tr
                      key={payment._id.toString()}
                      className="hover:bg-accent/40 transition-colors"
                    >
                      <td className="px-5 py-4 whitespace-nowrap text-foreground">
                        {new Date(payment.createdAt).toLocaleDateString(
                          undefined,
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          },
                        )}
                      </td>
                      <td className="px-5 py-4 text-foreground">
                        ₹{payment.amount.toFixed(2)}
                      </td>
                      <td className="px-5 py-4">
                        {payment.status === "success" ? (
                          <span className="inline-flex items-center rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-xs font-medium text-primary">
                            Completed
                          </span>
                        ) : payment.status === "refunded" ? (
                          <span className="inline-flex items-center rounded-full bg-orange-500/10 border border-orange-500/20 px-2.5 py-0.5 text-xs font-medium text-orange-600 dark:text-orange-400">
                            Refunded
                          </span>
                        ) : payment.status === "refund_pending" ? (
                          <span className="inline-flex items-center rounded-full bg-yellow-500/10 border border-yellow-500/20 px-2.5 py-0.5 text-xs font-medium text-yellow-600 dark:text-yellow-400">
                            Refund Pending
                          </span>
                        ) : payment.status === "failed" ? (
                          <span className="inline-flex items-center rounded-full bg-destructive/10 border border-destructive/20 px-2.5 py-0.5 text-xs font-medium text-destructive">
                            Failed
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-yellow-500/10 border border-yellow-500/20 px-2.5 py-0.5 text-xs font-medium text-yellow-600 dark:text-yellow-400">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-foreground">
                        {payment.planName}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {payment.status === "success" && (
                          <button className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <FileText className="h-3.5 w-3.5" /> PDF
                          </button>
                        )}
                        {payment.status === "success" &&
                          Date.now() - new Date(payment.createdAt).getTime() <=
                            30 * 24 * 60 * 60 * 1000 && (
                            <RefundButton
                              paymentId={payment._id.toString()}
                              amount={payment.amount}
                            />
                          )}
                        {payment.status !== "success" && (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
