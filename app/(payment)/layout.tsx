import type { ReactNode } from "react";

/**
 * Standalone layout for the payment group (checkout, success, failure).
 * No sidebar, no top nav — clean full-screen canvas.
 * Inherits root layout fonts, globals.css and the active ThemeProvider class.
 *
 * DO NOT add any theme class here (xenode-green, dark, imperial, …).
 * The theme is set on <html> by ThemeProvider and must not be overridden.
 */
export default function PaymentLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
