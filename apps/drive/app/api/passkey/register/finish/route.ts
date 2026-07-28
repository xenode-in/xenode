import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Passkeys are now enrolled in Xenode Accounts after the Vault is unlocked.",
      code: "accounts_passkey_enrollment_required",
    },
    { status: 410 },
  );
}
