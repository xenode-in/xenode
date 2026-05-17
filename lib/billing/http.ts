import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { isRazorpaySDKError } from "@/lib/payment/razorpayUtils";

/**
 * Small helpers used by every billing route to keep parsing/response shape
 * consistent. Not a framework — just shared plumbing.
 */

export class BillingError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

export async function parseJson<T>(
  request: Request,
  schema: ZodSchema<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new BillingError(
      400,
      formatZodError(result.error),
      "invalid_request",
    );
  }
  return result.data;
}

function formatZodError(error: ZodError): string {
  const first = error.issues[0];
  if (!first) return "Invalid request body";
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

export function jsonError(error: unknown) {
  if (error instanceof BillingError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  // Surface Razorpay SDK errors as 4xx with their description, not as 500.
  // The SDK rejects with { statusCode, error: { code, description, field } }.
  if (isRazorpaySDKError(error)) {
    const status =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 502;
    return NextResponse.json(
      {
        error: error.error?.description ?? "Payment gateway error",
        code: error.error?.code ?? "gateway_error",
        field: error.error?.field,
      },
      { status },
    );
  }
  const message =
    error instanceof Error ? error.message : "Internal server error";
  return NextResponse.json({ error: message }, { status: 500 });
}
