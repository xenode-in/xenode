import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Subscription from "@/models/Subscription";
import SubscriptionOffer from "@/models/SubscriptionOffer";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();

  const offers = await SubscriptionOffer.find().sort({ createdAt: -1 }).lean();
  const usageCounts = await Promise.all(
    offers.map(async (offer) => ({
      offerId: offer._id.toString(),
      usageCount: await Subscription.countDocuments({
        offerApplied: true,
        "metadata.offerId": offer._id.toString(),
      }),
    })),
  );
  const usageMap = new Map(usageCounts.map((item) => [item.offerId, item.usageCount]));
  const activeOffer = offers.find((offer) => offer.isActive) || null;

  return NextResponse.json({
    activeOffer,
    offers: offers.map((offer) => ({
      ...offer,
      usageCount: usageMap.get(offer._id.toString()) || 0,
    })),
  });
}
