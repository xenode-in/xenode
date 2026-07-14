import mongoose from "mongoose";
import dotenv from "dotenv";
import { PricingConfig } from "../models/PricingConfig";

dotenv.config({ path: ".env.local" });

async function renamePlans() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("Connected to MongoDB.");

  const config = await PricingConfig.findOne();
  if (!config) {
    console.log("No config found.");
    process.exit(0);
  }

  let updated = false;
  for (const plan of config.plans) {
    if (plan.slug === "basic" && plan.name !== "Basic") {
      plan.name = "Basic";
      updated = true;
    } else if (plan.slug === "pro" && plan.name !== "Pro") {
      plan.name = "Pro";
      updated = true;
    } else if (plan.slug === "plus" && plan.name !== "Plus") {
      plan.name = "Plus";
      updated = true;
    } else if (plan.slug === "max" && plan.name !== "Max") {
      plan.name = "Max";
      updated = true;
    }
  }

  if (updated) {
    await config.save();
    console.log("Plans renamed successfully.");
  } else {
    console.log("Plans already renamed.");
  }

  await mongoose.disconnect();
}

renamePlans().catch(console.error);
