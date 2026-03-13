import type { ReactNode } from "react";

/**
 * Standalone layout for payment result pages.
 * No sidebar, no top nav — just a clean full-screen canvas.
 * Inherits the root layout's fonts and globals.css.
 */
export default function PaymentLayout({ children }: { children: ReactNode }) {
  return (
    <div className="xenode-green min-h-screen w-full bg-background">
      {children}
    </div>
  );
}
