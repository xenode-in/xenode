import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function renamePlans() {
  const client = new MongoClient(process.env.MONGODB_URI as string);
  await client.connect();
  const db = client.db();
  
  const config = await db.collection("pricingconfigs").findOne({});
  if (!config) {
    console.log("No config found.");
    process.exit(0);
  }

  let updated = false;
  const newPlans = config.plans.map((plan: any) => {
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
    return plan;
  });

  if (updated) {
    await db.collection("pricingconfigs").updateOne({ _id: config._id }, { $set: { plans: newPlans } });
    console.log("Plans renamed successfully.");
  } else {
    console.log("Plans already renamed.");
  }

  await client.close();
}

renamePlans().catch(console.error);
