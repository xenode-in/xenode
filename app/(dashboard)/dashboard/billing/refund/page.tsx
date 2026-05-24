"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface PaymentSummary {
  id: string;
  razorpayPaymentId: string;
  amount: number;
  currency: string;
  planName: string;
  billingCycle: string;
  paidAt: string;
  windowEndsAt: string;
  daysRemaining: number;
}

interface EligibilityResponse {
  eligible: boolean;
  reason?: string;
  payment?: PaymentSummary;
  existingRequest?: {
    id: string;
    status: string;
    createdAt: string;
  };
}

export default function RefundRequestPage() {
  const router = useRouter();
  const [eligibility, setEligibility] = useState<EligibilityResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/refunds/eligibility");
      const data = await res.json();
      setEligibility(data);
    } catch {
      setError("Failed to check eligibility. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (reason.trim().length < 10) {
      setError("Please tell us briefly why you're requesting a refund (at least 10 characters).");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/refunds/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit refund request");
      router.push(`/dashboard/support/${data.ticketId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link
          href="/dashboard/billing"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to billing
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">
          Request a refund
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          We offer a 14-day money-back guarantee on the first payment of any paid plan.
        </p>
      </div>

      {!eligibility?.eligible ? (
        <NotEligibleCard
          reason={eligibility?.reason ?? "Refund not available."}
          payment={eligibility?.payment}
          existingRequest={eligibility?.existingRequest}
        />
      ) : (
        <>
          {eligibility.payment && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div className="space-y-3 flex-1">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      You&apos;re eligible for a refund
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {eligibility.payment.daysRemaining}{" "}
                      {eligibility.payment.daysRemaining === 1 ? "day" : "days"}{" "}
                      remaining in your 14-day window
                    </p>
                  </div>
                  <dl className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                    <dt className="text-muted-foreground">Plan</dt>
                    <dd className="text-foreground font-medium">
                      {eligibility.payment.planName} ({eligibility.payment.billingCycle})
                    </dd>
                    <dt className="text-muted-foreground">Amount</dt>
                    <dd className="text-foreground font-medium">
                      {eligibility.payment.currency} {eligibility.payment.amount.toFixed(2)}
                    </dd>
                    <dt className="text-muted-foreground">Paid on</dt>
                    <dd className="text-foreground">
                      {new Date(eligibility.payment.paidAt).toLocaleDateString()}
                    </dd>
                    <dt className="text-muted-foreground">Refund window ends</dt>
                    <dd className="text-foreground">
                      {new Date(eligibility.payment.windowEndsAt).toLocaleDateString()}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          )}

          <form
            onSubmit={submit}
            className="space-y-5 rounded-xl border border-border bg-card p-6"
          >
            <div className="space-y-2">
              <Label htmlFor="reason">
                Tell us why you&apos;re requesting a refund
              </Label>
              <p className="text-xs text-muted-foreground">
                A brief explanation helps us improve the product. Our team will review
                and respond within 1-2 business days.
              </p>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What didn't work for you?"
                rows={6}
                maxLength={2000}
              />
              <p className="text-xs text-muted-foreground text-right">
                {reason.length}/2000
              </p>
            </div>

            <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
              <p>
                <strong className="text-foreground">What happens next:</strong>
              </p>
              <ul className="list-disc list-inside space-y-1 pl-1">
                <li>Our team reviews your request (1-2 business days).</li>
                <li>If approved, the refund is initiated immediately and arrives in 5-7 business days.</li>
                <li>Your subscription is cancelled and your account moves to the free plan after the refund settles.</li>
              </ul>
            </div>

            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm px-4 py-3">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              <Button type="button" variant="outline" asChild>
                <Link href="/dashboard/billing">Cancel</Link>
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Submit refund request
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

function NotEligibleCard({
  reason,
  payment,
  existingRequest,
}: {
  reason: string;
  payment?: PaymentSummary;
  existingRequest?: { id: string; status: string; createdAt: string };
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground mb-1">
              Refund not available
            </p>
            <p className="text-sm text-muted-foreground">{reason}</p>

            {payment && (
              <dl className="mt-4 grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                <dt className="text-muted-foreground">Plan</dt>
                <dd className="text-foreground">
                  {payment.planName} ({payment.billingCycle})
                </dd>
                <dt className="text-muted-foreground">Paid on</dt>
                <dd className="text-foreground">
                  {new Date(payment.paidAt).toLocaleDateString()}
                </dd>
              </dl>
            )}
          </div>
        </div>
      </div>

      {existingRequest && (
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-foreground">
            You already have a refund request in progress.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Status: <span className="font-medium">{existingRequest.status}</span> ·
            Submitted {new Date(existingRequest.createdAt).toLocaleDateString()}
          </p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-sm text-foreground">
          Have another question or concern?
        </p>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          Our support team is here to help with any billing or account issue.
        </p>
        <Button asChild variant="outline">
          <Link href="/dashboard/support/new">Contact support</Link>
        </Button>
      </div>
    </div>
  );
}
