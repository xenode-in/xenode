/**
 * DEPRECATED route: the unified webhook handler at
 *   /api/payment/razorpay/webhook
 * now processes all Razorpay events (orders, payments, refunds, subscriptions,
 * disputes) through a single dispatcher.
 *
 * This route is kept as a thin forwarder for one release in case the Razorpay
 * dashboard still has it configured. It rebuilds the request and hands it to
 * the new handler so signature verification and idempotency apply uniformly.
 *
 * Remove this file in the v1.1 cleanup pass after confirming no dashboard
 * webhook points here.
 */

import { POST as unifiedHandler } from "@/app/api/payment/razorpay/webhook/route";

export async function POST(request: Request) {
  // Forward as-is: headers (incl. signature) and body are preserved.
  return unifiedHandler(request);
}
