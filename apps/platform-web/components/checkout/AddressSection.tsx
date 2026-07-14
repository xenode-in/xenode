"use client";

import { useState } from "react";
import type { UseFormRegister, FieldErrors } from "react-hook-form";
import type { CheckoutFormValues } from "./CheckoutForm";

const INDIAN_STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh",
  "Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka",
  "Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram",
  "Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu",
  "Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal",
  "Andaman and Nicobar Islands","Chandigarh","Dadra and Nagar Haveli and Daman and Diu",
  "Delhi","Jammu and Kashmir","Ladakh","Lakshadweep","Puducherry",
];

interface AddressSectionProps {
  register: UseFormRegister<CheckoutFormValues>;
  errors: FieldErrors<CheckoutFormValues>;
  defaultOpen?: boolean;
}

export default function AddressSection({ register, errors, defaultOpen = false }: AddressSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-white/5"
      >
        <div>
          <p className="text-sm font-semibold text-foreground">Billing Address</p>
          <p className="text-xs text-muted-foreground">Optional — required for GST invoice</p>
        </div>
        <span className={`text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-5 pb-5 pt-4 space-y-4">
          {/* Full Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Full Name</label>
            <input
              {...register("address.name")}
              placeholder="As on GST certificate"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {errors.address?.name && (
              <p className="mt-1 text-xs text-destructive">{errors.address.name.message}</p>
            )}
          </div>

          {/* Address Line 1 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Address Line 1</label>
            <input
              {...register("address.line1")}
              placeholder="Street, Building, Flat No."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* City + PIN */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">City</label>
              <input
                {...register("address.city")}
                placeholder="City"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">PIN Code</label>
              <input
                {...register("address.pin")}
                placeholder="6-digit PIN"
                maxLength={6}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {errors.address?.pin && (
                <p className="mt-1 text-xs text-destructive">{errors.address.pin.message}</p>
              )}
            </div>
          </div>

          {/* State */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">State</label>
            <select
              {...register("address.state")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select state</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Country — locked to India */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Country</label>
            <input
              value="India"
              readOnly
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
            />
          </div>
        </div>
      )}
    </div>
  );
}
