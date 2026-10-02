/**
 * Ensures the super admin account exists in the database.
 * Called once at startup / first request.
 * Credentials are read from ADMIN_USERNAME and ADMIN_PASSWORD env vars.
 */
import dbConnect from "@/lib/mongodb";
import { Admin } from "@xenode/database";
import bcrypt from "bcryptjs";

let ensured = false;

export async function ensureSuperAdmin() {
  if (ensured) return;

  await dbConnect();

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.warn(
      "[Admin] ADMIN_USERNAME or ADMIN_PASSWORD not set — skipping super admin seed."
    );
    ensured = true;
    return;
  }

  const existing = await Admin.findOne({ username: username.toLowerCase() });
  if (existing) {
    ensured = true;
    return; // Do not resurrect a disabled/demoted operator from seed settings.
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await Admin.create({
    username,
    passwordHash,
    role: "super_admin",
    isActive: true,
  });
  ensured = true;

  console.log(`[Admin] Super admin '${username}' created.`);
}
