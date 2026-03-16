import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PaymentSuccessIcon } from "@/app/components/payment/PaymentResultIcon";

interface SuccessPageProps {
  searchParams: Promise<{
    txnid?: string;
    plan?: string;
    amount?: string;
  }>;
}

export const metadata = {
  title: "Payment Successful | Xenode",
  robots: "noindex",
};

export default async function PaymentSuccessPage({
  searchParams,
}: SuccessPageProps) {
  const params = await searchParams;
  const { txnid, plan, amount } = params;

  // Hard guard — never show a blank success page without a txnid
  if (!txnid) redirect("/dashboard/billing");

  const formattedAmount = amount ? `₹${parseFloat(amount).toFixed(2)}` : null;

  const formattedDate = new Date().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const shortTxnId = txnid.length > 20 ? `${txnid.slice(0, 20)}…` : txnid;

  return (
    <div className="flex min-h-screen w-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        {/* Icon */}
        <div className="mb-8 flex justify-center">
          <PaymentSuccessIcon />
        </div>

        {/* Heading */}
        <div className="mb-8 text-center">
          <h1 className="font-brand mb-2 text-3xl font-bold tracking-tight text-foreground">
            Payment Successful
          </h1>
          <p className="text-muted-foreground">
            Your plan is now active. Welcome to Xenode Pro.
          </p>
        </div>

        {/* Receipt card */}
        <div className="mb-8 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Receipt
          </h2>
          <div className="space-y-3">
            {plan && <ReceiptRow label="Plan" value={plan} />}
            {formattedAmount && (
              <ReceiptRow
                label="Amount Paid"
                value={formattedAmount}
                highlight
              />
            )}
            <ReceiptRow label="Date" value={formattedDate} />
            <ReceiptRow label="Transaction ID" value={shortTxnId} mono />
            <ReceiptRow label="Status" value="Confirmed" green />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <Link
            href="/dashboard"
            className="flex h-11 w-full items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Go to Dashboard
          </Link>
          <Link
            href="/dashboard/billing"
            className="flex h-11 w-full items-center justify-center rounded-lg border border-border px-6 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            View Billing
          </Link>
        </div>

        {/* Footer note */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          A confirmation email has been sent to your registered address.
        </p>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────

function ReceiptRow({
  label,
  value,
  highlight = false,
  mono = false,
  green = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  mono?: boolean;
  green?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={[
          "text-sm",
          highlight ? "font-bold text-foreground" : "text-foreground",
          mono ? "font-mono text-xs" : "",
          green ? "font-semibold text-emerald-500" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
