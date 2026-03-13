import { redirect } from "next/navigation";
import Link from "next/link";
import { PaymentFailureIcon } from "@/app/components/payment/PaymentResultIcon";

interface FailurePageProps {
  searchParams: Promise<{
    txnid?: string;
    error?: string;
    plan?: string;
    amount?: string;
  }>;
}

export const metadata = {
  title: "Payment Failed — Xenode",
  robots: "noindex",
};

// Human-readable error messages for PayU error codes
const ERROR_MESSAGES: Record<string, string> = {
  payment_failed: "Your payment could not be processed.",
  hash_mismatch: "Payment verification failed. Please try again.",
  transaction_not_found:
    "Transaction record not found. Please contact support.",
  invalid_session: "Your session expired. Please start a new checkout.",
  user_not_found: "Account not found. Please sign in and try again.",
  server_error: "Something went wrong on our end. Please try again shortly.",
};

export default async function PaymentFailurePage({
  searchParams,
}: FailurePageProps) {
  const params = await searchParams;
  const { txnid, error, plan, amount } = params;

  if (!txnid && !error) redirect("/dashboard/billing");

  const errorMessage =
    (error && ERROR_MESSAGES[error]) ??
    "Your payment was not completed. No charge was made to your account.";

  const shortTxnId = txnid
    ? txnid.length > 20
      ? `${txnid.slice(0, 20)}…`
      : txnid
    : null;

  const formattedDate = new Date().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="flex min-h-screen w-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        {/* Icon */}
        <div className="mb-8 flex justify-center">
          <PaymentFailureIcon />
        </div>

        {/* Heading */}
        <div className="mb-8 text-center">
          <h1 className="font-brand mb-2 text-3xl font-bold tracking-tight text-foreground">
            Payment Failed
          </h1>
          <p className="text-muted-foreground">{errorMessage}</p>
        </div>

        {/* Details card */}
        <div className="mb-8 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Details
          </h2>
          <div className="space-y-3">
            {plan && <DetailRow label="Plan" value={plan} />}
            {amount && (
              <DetailRow
                label="Amount"
                value={`₹${parseFloat(amount).toFixed(2)}`}
              />
            )}
            <DetailRow label="Date" value={formattedDate} />
            {shortTxnId && (
              <DetailRow label="Transaction ID" value={shortTxnId} mono />
            )}
            <DetailRow label="Status" value="Not Charged" red />
          </div>
        </div>

        {/* Reassurance notice */}
        <div className="mb-6 rounded-lg border border-border bg-card/60 px-4 py-3">
          <p className="text-center text-xs text-muted-foreground">
            🔒 No amount has been deducted from your account.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <Link
            href="/pricing"
            className="flex h-11 w-full items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Try Again
          </Link>
          <Link
            href="/dashboard/billing"
            className="flex h-11 w-full items-center justify-center rounded-lg border border-border px-6 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go to Billing
          </Link>
          <a
            href="mailto:support@xenode.app"
            className="flex h-11 w-full items-center justify-center rounded-lg px-6 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Contact Support
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────

function DetailRow({
  label,
  value,
  mono = false,
  red = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  red?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={[
          "text-sm",
          mono ? "font-mono text-xs text-foreground" : "text-foreground",
          red ? "font-semibold text-destructive" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
