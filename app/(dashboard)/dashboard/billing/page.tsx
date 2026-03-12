import UpgradePlanModal from "@/components/dashboard/UpgradePlanModal";
import { CreditCard, Clock, FileText } from "lucide-react";
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

export default async function BillingPage() {
  const session = await getServerSession();
  let usage = null;
  let payments: any[] = [];

  if (session?.user?.id) {
    await dbConnect();
    [usage, payments] = await Promise.all([
      Usage.findOne({ userId: session.user.id }),
      Payment.find({ userId: session.user.id }).sort({ createdAt: -1 }).lean(),
    ]);
  }

  const isPro = usage?.plan === "pro" || usage?.plan === "enterprise";
  const planName = usage?.plan
    ? usage.plan.charAt(0).toUpperCase() + usage.plan.slice(1) + " Plan"
    : "Free Tier";

  const storageLimit = usage?.storageLimitBytes
    ? formatBytes(usage.storageLimitBytes)
    : "1 TB";
  const egressLimit = usage?.egressLimitBytes
    ? formatBytes(usage.egressLimitBytes)
    : "500 GB";
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Billing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your subscription and billing
          </p>
        </div>
        <UpgradePlanModal />
      </div>

      {/* Current Plan */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-foreground">Current Plan</h3>
          <span
            className={`text-xs font-medium px-3 py-1 rounded-full ${
              isPro
                ? "bg-[#7cb686]/20 text-[#7cb686]"
                : "bg-primary/10 text-primary"
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
        </div>
      </div>

      {/* Invoice History */}
      <h3 className="text-lg font-medium text-foreground mt-12 mb-2">
        Invoice History
      </h3>
      <div className="bg-card border border-border rounded-xl tracking-tight overflow-hidden">
        {payments.length === 0 ? (
          <div className="px-6 py-12 text-center text-[#e8e4d9]/70">
            <p>
              No invoices yet. Billing history will appear here once you
              upgrade.
            </p>
          </div>
        ) : (
          <div className="w-full relative overflow-x-auto text-[#e8e4d9]/80 text-sm">
            <table className="w-full text-left">
              <thead className="text-xs uppercase bg-white/5 text-[#e8e4d9]/60">
                <tr>
                  <th scope="col" className="px-6 py-4 font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-6 py-4 font-medium">
                    Amount
                  </th>
                  <th scope="col" className="px-6 py-4 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-4 font-medium">
                    Plan
                  </th>
                  <th scope="col" className="px-6 py-4 font-medium text-right">
                    Receipt
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.map((payment) => (
                  <tr
                    key={payment._id.toString()}
                    className="hover:bg-white/5 transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      {new Date(payment.createdAt).toLocaleDateString(
                        undefined,
                        {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        },
                      )}
                    </td>
                    <td className="px-6 py-4">₹{payment.amount.toFixed(2)}</td>
                    <td className="px-6 py-4">
                      {payment.status === "success" ? (
                        <span className="text-xs font-medium px-2 py-1 rounded bg-[#7cb686]/20 text-[#7cb686]">
                          Completed
                        </span>
                      ) : payment.status === "failed" ? (
                        <span className="text-xs font-medium px-2 py-1 rounded bg-red-500/20 text-red-500">
                          Failed
                        </span>
                      ) : (
                        <span className="text-xs font-medium px-2 py-1 rounded bg-yellow-500/20 text-yellow-500">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">{payment.planName}</td>
                    <td className="px-6 py-4 text-right">
                      {payment.status === "success" ? (
                        <span className="text-[#7cb686] hover:text-[#6ba075] cursor-pointer inline-flex items-center transition-colors">
                          <FileText className="w-4 h-4 mr-1" /> PDF
                        </span>
                      ) : (
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
  );
}
