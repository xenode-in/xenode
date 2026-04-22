"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface SubscribeButtonProps {
  phone: string;
  planSlug: string;
  planName: string;
  billingCycle: "monthly" | "yearly" | "quarterly" | "lifetime";
  couponCode?: string | null;
  disabled?: boolean;
  offerLabel?: string | null;
  user: {
    name: string;
    email: string;
  };
  onError?: (message: string) => void;
  onSettled?: () => void;
}

export default function SubscribeButton({
  phone,
  planSlug,
  planName,
  billingCycle,
  couponCode,
  disabled,
  offerLabel,
  user,
  onError,
  onSettled,
}: SubscribeButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function startSubscription() {
    try {
      setSubmitting(true);
      onError?.("");

      const createResponse = await fetch("/api/subscriptions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, planSlug, billingCycle, couponCode }),
      });
      const createData = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(createData.error || "Failed to create subscription");
      }

      const options = {
        key: createData.razorpayKeyId,
        subscription_id: createData.subscriptionId,
        name: "Xenode",
        description: "Xenode recurring subscription",
        recurring: true,
        prefill: {
          name: user.name,
          email: user.email,
          contact: phone,
          method: "upi",
        },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_subscription_id: string;
          razorpay_signature: string;
        }) => {
          const verifyResponse = await fetch("/api/subscriptions/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(response),
          });

          const verifyData = await verifyResponse.json();
          if (!verifyResponse.ok) {
            throw new Error(verifyData.error || "Subscription verification failed");
          }

          router.refresh();
          router.push(
            `/payment/success?subscription_id=${createData.subscriptionId}&plan=${encodeURIComponent(planName)}`,
          );
        },
        modal: {
          ondismiss: () => {
            setSubmitting(false);
            onSettled?.();
          },
        },
        theme: { color: "#111111" },
      };

      const razorpay = new window.Razorpay(options);
      razorpay.open();
    } catch (error) {
      onError?.(
        error instanceof Error ? error.message : "Failed to start subscription",
      );
      setSubmitting(false);
      onSettled?.();
    }
  }

  return (
    <div className="space-y-2">
      {offerLabel ? (
        <div className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          {offerLabel}
        </div>
      ) : null}
      <button
        type="button"
        disabled={disabled || submitting}
        onClick={() => void startSubscription()}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 shadow-md"
      >
        {submitting ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
            Processing...
          </>
        ) : (
          <>
            <Lock className="h-4 w-4" />
            Start subscription
          </>
        )}
      </button>
    </div>
  );
}
