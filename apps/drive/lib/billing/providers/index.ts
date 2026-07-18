import type { AnyBillingProvider } from "./IBillingProvider";
import { razorpayProvider } from "./RazorpayProvider";

/**
 * Provider registry. Today there is one entry; tomorrow there might be two
 * and routes can pick by gateway name (e.g. for region-specific defaults).
 */

const REGISTRY: Record<string, AnyBillingProvider> = {
  razorpay: razorpayProvider,
};

/** Default provider used by all billing services. */
export function getDefaultProvider(): AnyBillingProvider {
  return razorpayProvider;
}

export function getProvider(name: string): AnyBillingProvider | null {
  return REGISTRY[name] ?? null;
}

export { razorpayProvider };
export type { AnyBillingProvider } from "./IBillingProvider";
