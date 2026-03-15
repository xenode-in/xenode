import { getAdminSession } from "@/lib/admin/session";
import { redirect } from "next/navigation";
import { SimulatorClient } from "./SimulatorClient";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import mongoose from "mongoose";

export default async function SimulatorPage() {
  const session = await getAdminSession();
  if (!session || session.role !== "super_admin") {
    redirect("/admin/login");
  }

  await dbConnect();
  
  // Fetch some real users from the db to populate the dropdown
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database not connected");

  // Get users who actually have a Usage record
  const users = await db.collection("user").find({}, { projection: { name: 1, email: 1 } }).limit(50).toArray();
  const serializedUsers = users.map(u => ({ id: u._id.toString(), name: u.name, email: u.email }));

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Billing Simulator</h1>
      <p className="text-zinc-400 mb-8">
        Test edge cases for Campaigns, Grace Periods, and Recurring Billing without waiting for cron jobs.
      </p>
      <SimulatorClient users={serializedUsers} />
    </div>
  );
}