"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Lock } from "lucide-react";
import Script from "next/script";
import { useRouter } from "next/navigation";
import type { CheckoutPlan, CheckoutUser, CouponResult } from "./CheckoutPage";
import PaymentMethodToggle from "./PaymentMethodToggle";
import AddressSection from "./AddressSection";
import CouponInput from "./CouponInput";
import SubscribeButton from "@/components/SubscribeButton";
import { getEffectivePriceForCycle } from "@/lib/pricing/pricingService";

const addressSchema = z.object({
  name: z.string().optional(),
  line1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pin: z
    .string()
    .regex(/^\d{6}$/, "Must be a 6-digit PIN")
    .optional()
    .or(z.literal("")),
  country: z.string().optional(),
});

const schema = z.object({
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
  paymentMethod: z.enum(["autopay", "direct"]),
  address: addressSchema,
});

export type CheckoutFormValues = z.infer<typeof schema>;

interface CheckoutFormProps {
  plan: CheckoutPlan;
  user: CheckoutUser;
  prorationCredit: number;
  finalAmount: number;
  onCouponChange: (result: CouponResult | null) => void;
  appliedCoupon: CouponResult | null;
}

export default function CheckoutForm({
  plan,
  user,
  finalAmount,
  onCouponChange,
  appliedCoupon,
}: CheckoutFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [razorpayLoaded, setRazorpayLoaded] = useState(false);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CheckoutFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      phone: user.phone || "",
      paymentMethod: "direct",
      address: {
        name: user.billingAddress?.name || "",
        line1: user.billingAddress?.line1 || "",
        city: user.billingAddress?.city || "",
        state: user.billingAddress?.state || "",
        pin: user.billingAddress?.pin || "",
        country: "India",
      },
    },
  });

  const paymentMethod = watch("paymentMethod");
  const recurringPlanId = plan.pricing.find(
    (entry) => entry.cycle === plan.billingCycle,
  )?.razorpayPlanId;
  const isSubscriptionEligible =
    plan.billingCycle !== "lifetime" && Boolean(recurringPlanId);

  const cycleBasePrice = getEffectivePriceForCycle(
    plan.pricing,
    plan.billingCycle,
  );
  const couponBasePrice = Math.max(1, plan.originalPrice - plan.campaignDiscount);

  const handlePayment = async (values: CheckoutFormValues) => {
    setServerError(null);
    setIsSubmitting(true);

    try {
      if (values.paymentMethod === "autopay") {
        if (!isSubscriptionEligible) {
          throw new Error(
            "Recurring subscriptions are only available for billing cycles with Razorpay recurring configured.",
          );
        }

        return;
      }

      const res = await fetch("/api/payment/razorpay/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: finalAmount,
          planName: plan.name,
          planSlug: plan.slug,
          billingCycle: plan.billingCycle,
          couponCode: appliedCoupon?.code ?? null,
          storageLimitBytes: plan.storageLimitBytes,
          planPriceINR: plan.originalPrice,
          basePlanPriceINR: cycleBasePrice,
          notes: {
            phone: values.phone,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to initiate order");
      }

      if (!window.Razorpay) {
        throw new Error("Razorpay SDK not loaded. Please refresh the page.");
      }

      const options = {
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        name: "Xenode",
        description: `Upgrade to ${plan.name}`,
        order_id: data.orderId,
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          const verifyRes = await fetch("/api/payment/razorpay/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          });

          const verifyData = await verifyRes.json();
          if (verifyRes.ok) {
            router.push(
              `/payment/success?txnid=${response.razorpay_order_id}&plan=${plan.name}&amount=${finalAmount}`,
            );
            return;
          }

          setServerError(verifyData.error || "Verification failed");
        },
        prefill: {
          name: user.name,
          email: user.email,
          contact: values.phone,
          method: "upi",
        },
        theme: { color: "#111111" },
        modal: {
          ondismiss: () => {
            setIsSubmitting(false);
          },
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.";
      setServerError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        crossOrigin="anonymous"
        onLoad={() => setRazorpayLoaded(true)}
      />
      <form
        onSubmit={handleSubmit(handlePayment)}
        className="space-y-4"
        noValidate
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Payment Details
        </p>

        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <p className="text-sm font-semibold text-foreground">Contact</p>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Email
            </label>
            <input
              value={user.email}
              readOnly
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Phone Number <span className="text-destructive">*</span>
            </label>
            <div className="flex">
              <span className="flex items-center rounded-l-lg border border-r-0 border-border bg-muted px-3 text-sm text-muted-foreground select-none">
                +91
              </span>
              <input
                {...register("phone")}
                type="tel"
                maxLength={10}
                placeholder="9876543210"
                className="flex-1 rounded-r-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {errors.phone ? (
              <p className="mt-1.5 text-xs text-destructive">
                {errors.phone.message}
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <p className="text-sm font-semibold text-foreground">Coupon Code</p>
          <CouponInput
            planSlug={plan.slug}
            planPriceINR={couponBasePrice}
            onApply={onCouponChange}
            applied={appliedCoupon}
          />
        </div>

        <AddressSection
          register={register}
          errors={errors}
          defaultOpen={!!user.billingAddress?.name}
        />

        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <p className="text-sm font-semibold text-foreground">
            Payment Method
          </p>
          <PaymentMethodToggle
            value={paymentMethod}
            onChange={(value) => setValue("paymentMethod", value)}
          />
          {paymentMethod === "autopay" ? (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  How it works:{" "}
                </span>
                {isSubscriptionEligible
                  ? `You'll approve a UPI mandate in your UPI app. ${
                      plan.subscriptionOffer || appliedCoupon
                        ? `The first cycle is Rs.${finalAmount.toFixed(
                            2,
                          )}, then renewals continue at the full ${plan.billingCycle} plan price after the follow-up authorization.`
                        : `Renewals continue at the full ${plan.billingCycle} plan price.`
                    }`
                  : "Recurring subscriptions are only available for billing cycles with Razorpay recurring configured."}
              </p>
            </div>
          ) : null}
        </div>

        {serverError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
            <p className="text-sm text-destructive">{serverError}</p>
          </div>
        ) : null}

        {paymentMethod === "autopay" ? (
          <SubscribeButton
            phone={watch("phone")}
            planSlug={plan.slug}
            planName={plan.name}
            billingCycle={plan.billingCycle}
            couponCode={appliedCoupon?.code ?? null}
            disabled={
              Boolean(errors.phone) ||
              !razorpayLoaded ||
              !isSubscriptionEligible
            }
            offerLabel={
              plan.subscriptionOffer
                ? `${plan.subscriptionOffer.name}: ${plan.subscriptionOffer.discountPercent}% off first cycle`
                : null
            }
            user={{ name: user.name, email: user.email }}
            onError={(message) => setServerError(message || null)}
            onSettled={() => setIsSubmitting(false)}
          />
        ) : (
          <button
            type="submit"
            disabled={isSubmitting || !razorpayLoaded}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 shadow-md"
          >
            {isSubmitting ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Processing...
              </>
            ) : !razorpayLoaded ? (
              "Loading Payment..."
            ) : (
              <>
                <Lock className="h-4 w-4" /> Pay Rs.{finalAmount.toFixed(2)}{" "}
                securely
              </>
            )}
          </button>
        )}

        <p className="text-center text-xs text-muted-foreground">
          By completing this purchase you agree to Xenode&apos;s{" "}
          <a
            href="/terms"
            className="underline hover:text-foreground transition-colors"
          >
            Terms of Service
          </a>
          .
        </p>
      </form>
    </>
  );
}
