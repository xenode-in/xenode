"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import type { CheckoutPlan } from "./CheckoutPage";
import type { CheckoutUser } from "./CheckoutPage";
import PaymentMethodToggle from "./PaymentMethodToggle";
import AddressSection from "./AddressSection";

// ── Zod schema ───────────────────────────────────────────────────

const addressSchema = z.object({
  name:    z.string().optional(),
  line1:   z.string().optional(),
  city:    z.string().optional(),
  state:   z.string().optional(),
  pin:     z.string().regex(/^\d{6}$/, "Must be a 6-digit PIN").optional().or(z.literal("")),
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

// ── component ───────────────────────────────────────────────────

interface CheckoutFormProps {
  plan: CheckoutPlan;
  user: CheckoutUser;
  prorationCredit: number;
  finalAmount: number;
}

export default function CheckoutForm({ plan, user, finalAmount }: CheckoutFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        name:    user.billingAddress?.name    || "",
        line1:   user.billingAddress?.line1   || "",
        city:    user.billingAddress?.city    || "",
        state:   user.billingAddress?.state   || "",
        pin:     user.billingAddress?.pin     || "",
        country: "India",
      },
    },
  });

  const paymentMethod = watch("paymentMethod");

  const onSubmit = async (values: CheckoutFormValues) => {
    setServerError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/payment/payu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planName: plan.name,
          paymentMethod: values.paymentMethod,
          phone: values.phone,
          billingAddress:
            values.address?.name || values.address?.line1
              ? { ...values.address, country: "India" }
              : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setServerError(data.error || "Failed to initialize payment. Please try again.");
        return;
      }

      // Build and auto-submit a hidden form to PayU
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.action;
      Object.entries(data.params as Record<string, string>).forEach(([k, v]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = k;
        input.value = v;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    } catch {
      setServerError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Payment Details
      </h2>

      {/* ── Section A: Contact ── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <p className="text-sm font-semibold text-foreground">Contact</p>

        {/* Email — read-only */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
          <input
            value={user.email}
            readOnly
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
          />
        </div>

        {/* Phone with +91 prefix */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Phone Number <span className="text-destructive">*</span>
          </label>
          <div className="flex">
            <span className="flex items-center rounded-l-lg border border-r-0 border-border bg-muted px-3 text-sm text-muted-foreground select-none">
              🇮🇳 +91
            </span>
            <input
              {...register("phone")}
              type="tel"
              maxLength={10}
              placeholder="9876543210"
              className="flex-1 rounded-r-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {errors.phone && (
            <p className="mt-1 text-xs text-destructive">{errors.phone.message}</p>
          )}
        </div>
      </div>

      {/* ── Section B: Billing Address (collapsible) ── */}
      <AddressSection
        register={register}
        errors={errors}
        defaultOpen={!!user.billingAddress?.name}
      />

      {/* ── Section C: Payment Method ── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <p className="text-sm font-semibold text-foreground">Payment Method</p>
        <PaymentMethodToggle
          value={paymentMethod}
          onChange={(v) => setValue("paymentMethod", v)}
        />
        {paymentMethod === "autopay" && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">How it works: </span>
              You’ll approve a UPI mandate in your UPI app (GPay / PhonePe / Paytm).
              Xenode will automatically charge ₹{finalAmount.toFixed(2)} every 30 days.
              You can cancel anytime from your UPI app or from your Xenode billing page.
            </p>
          </div>
        )}
      </div>

      {/* Server error */}
      {serverError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
          <p className="text-sm text-destructive">{serverError}</p>
        </div>
      )}

      {/* CTA */}
      <button
        type="submit"
        disabled={isSubmitting}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
            Processing…
          </>
        ) : (
          <>🔒 Pay ₹{finalAmount.toFixed(2)} securely</>
        )}
      </button>

      <p className="text-center text-xs text-muted-foreground">
        By completing this purchase you agree to Xenode’s{" "}
        <a href="/terms" className="underline hover:text-foreground">Terms of Service</a>.
      </p>
    </form>
  );
}
