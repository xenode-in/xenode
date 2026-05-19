"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Script from "next/script";
import type { CheckoutPlan, CheckoutUser, CouponResult } from "./CheckoutPage";
import AddressSection from "./AddressSection";
import CouponInput from "./CouponInput";
import SubscribeButton from "@/components/SubscribeButton";

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
  address: addressSchema,
});

export type CheckoutFormValues = z.infer<typeof schema>;

interface CheckoutFormProps {
  plan: CheckoutPlan;
  user: CheckoutUser;
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
  const [razorpayLoaded, setRazorpayLoaded] = useState(false);

  const {
    register,
    watch,
    formState: { errors },
  } = useForm<CheckoutFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      phone: user.phone || "",
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

  const recurringPlanId = plan.pricing.find(
    (entry) => entry.cycle === plan.billingCycle,
  )?.razorpayPlanId;
  const isSubscriptionEligible =
    plan.billingCycle !== "lifetime" && Boolean(recurringPlanId);

  const couponBasePrice = Math.max(1, plan.originalPrice - plan.campaignDiscount);
  const phone = watch("phone");

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        crossOrigin="anonymous"
        onLoad={() => setRazorpayLoaded(true)}
      />
      <form className="space-y-4" noValidate>
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

        <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">How it works: </span>
            {isSubscriptionEligible
              ? `You'll approve a UPI mandate in your UPI app. ${
                  plan.subscriptionOffer || appliedCoupon
                    ? `The first cycle is Rs.${finalAmount.toFixed(2)}, then renewals continue at Rs.${plan.originalPrice.toFixed(2)}/${plan.billingCycle} automatically.`
                    : `Renewals continue at Rs.${plan.originalPrice.toFixed(2)}/${plan.billingCycle} automatically.`
                }`
              : "Recurring subscriptions are not available for this plan or billing cycle."}
          </p>
        </div>

        {serverError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
            <p className="text-sm text-destructive">{serverError}</p>
          </div>
        ) : null}

        <SubscribeButton
          phone={phone}
          planSlug={plan.slug}
          planName={plan.name}
          billingCycle={plan.billingCycle}
          couponCode={appliedCoupon?.code ?? null}
          disabled={
            Boolean(errors.phone) || !razorpayLoaded || !isSubscriptionEligible
          }
          offerLabel={
            plan.subscriptionOffer
              ? `${plan.subscriptionOffer.name}: ${plan.subscriptionOffer.discountPercent}% off first cycle`
              : null
          }
          user={{ name: user.name, email: user.email }}
          onError={(message) => setServerError(message || null)}
        />

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
