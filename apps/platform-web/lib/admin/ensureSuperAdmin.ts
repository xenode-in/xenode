/**
 * Ensures the super admin account exists in the database.
 * Called once at startup / first request.
 * Credentials are read from ADMIN_USERNAME and ADMIN_PASSWORD env vars.
 */
import dbConnect from "@/lib/mongodb";
import Admin from "@/models/Admin";
import bcrypt from "bcryptjs";

let ensured = false;

export async function ensureSuperAdmin() {
  if (ensured) return;
  ensured = true;

  await dbConnect();

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.warn(
      "[Admin] ADMIN_USERNAME or ADMIN_PASSWORD not set — skipping super admin seed."
    );
    return;
  }

  const existing = await Admin.findOne({ username, role: "super_admin" });
  if (existing) return; // already seeded

  const passwordHash = await bcrypt.hash(password, 12);
  await Admin.create({
    username,
    passwordHash,
    role: "super_admin",
    isActive: true,
  });

  console.log(`[Admin] Super admin '${username}' created.`);
}
