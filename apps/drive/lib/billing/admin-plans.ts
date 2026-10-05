import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, BillingError } from "./http";
import { cachedResponse, withIdempotency } from "./idempotency";
import { syncUserSubscriptionState, type PersonalPlanOverride } from "@/lib/subscriptions/service";

const plan = z.enum(["free", "basic", "pro", "plus", "max", "enterprise"]);
const expiry = z.string().datetime({ offset: true }).nullable().optional();
const patchSchema = z.object({
  plan: plan.optional(),
  planExpiresAt: expiry,
  storageLimitBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  egressLimitBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, "No valid fields to update");
const planSchema = z.object({ plan, expiresAt: expiry }).strict();

/** Both admin surfaces share validation, deduplication and the entitlement writer. */
export async function updateAdminPlan(request: Request, userId: string, adminId: string, surface: "plan" | "usage") {
  const body = surface === "plan"
    ? await parseJson(request, planSchema)
    : await parseJson(request, patchSchema);
  const idempotency = await withIdempotency({
    request, userId: adminId, route: `admin/users/${userId}/${surface}`, body,
  });
  const cached = cachedResponse(idempotency);
  if (cached) return cached;
  try {
    const override: PersonalPlanOverride = { plan: body.plan };
    if (surface === "plan") {
      override.planExpiresAt = "expiresAt" in body && body.expiresAt ? new Date(body.expiresAt) : null;
    } else {
      if ("planExpiresAt" in body) override.planExpiresAt = body.planExpiresAt ? new Date(body.planExpiresAt) : null;
      if ("storageLimitBytes" in body) override.storageLimitBytes = body.storageLimitBytes;
      if ("egressLimitBytes" in body) override.egressLimitBytes = body.egressLimitBytes;
    }
    const { usage } = await syncUserSubscriptionState({
      userId, action: "admin", override, actor: { actorType: "admin", actorId: adminId },
    });
    if (!usage) throw new BillingError(404, "Usage not found", "usage_missing");
    const result = surface === "plan"
      ? { plan: usage.plan, planActivatedAt: usage.planActivatedAt, planExpiresAt: usage.planExpiresAt }
      : { usage };
    await idempotency.complete(200, result);
    return NextResponse.json(result);
  } catch (error) {
    await idempotency.fail();
    throw error;
  }
}
