/**
 * PaymentResultIcon.tsx
 * ----------------------
 * Inline SVG placeholder icons for the payment result pages.
 *
 * HOW TO REPLACE WITH REAL ASSETS:
 *   1. Drop your PNG/SVG/Lottie into public/images/payment/
 *   2. Replace the <svg> inside each component with:
 *      <Image src="/images/payment/success.png" width={120} height={120} alt="Payment successful" />
 *   3. For Lottie: npm install @lottiefiles/react-lottie-player and swap in <Player />
 *
 * The wrapper div dimensions (w-[120px] h-[120px]) are intentional —
 * keep them so the layout doesn't shift when you swap the asset.
 */

export function PaymentSuccessIcon() {
  return (
    <div
      aria-label="Payment successful"
      role="img"
      className="flex h-[120px] w-[120px] items-center justify-center rounded-full border-2 border-emerald-500/30 bg-emerald-500/10"
    >
      {/* ── PLACEHOLDER — replace this <svg> with your own asset ── */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        fill="none"
        className="h-14 w-14"
        aria-hidden="true"
      >
        {/* Outer ring */}
        <circle cx="32" cy="32" r="30" stroke="#10b981" strokeWidth="2" strokeOpacity="0.4" />
        {/* Inner filled circle */}
        <circle cx="32" cy="32" r="22" fill="#10b981" fillOpacity="0.15" />
        {/* Checkmark */}
        <path
          d="M20 33l8 8 16-16"
          stroke="#10b981"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* ── END PLACEHOLDER ── */}
    </div>
  );
}

export function PaymentFailureIcon() {
  return (
    <div
      aria-label="Payment failed"
      role="img"
      className="flex h-[120px] w-[120px] items-center justify-center rounded-full border-2 border-destructive/30 bg-destructive/10"
    >
      {/* ── PLACEHOLDER — replace this <svg> with your own asset ── */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        fill="none"
        className="h-14 w-14"
        aria-hidden="true"
      >
        {/* Outer ring */}
        <circle cx="32" cy="32" r="30" stroke="#ef4444" strokeWidth="2" strokeOpacity="0.4" />
        {/* Inner filled circle */}
        <circle cx="32" cy="32" r="22" fill="#ef4444" fillOpacity="0.12" />
        {/* X mark */}
        <path
          d="M22 22l20 20M42 22L22 42"
          stroke="#ef4444"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {/* ── END PLACEHOLDER ── */}
    </div>
  );
}
