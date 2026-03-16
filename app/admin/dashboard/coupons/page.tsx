import { getAdminSession } from "@/lib/admin/session";
import { redirect } from "next/navigation";
import dbConnect from "@/lib/mongodb";
import Coupon from "@/models/Coupon";
import { CouponManager } from "@/components/admin/CouponManager";

export const metadata = { title: "Coupons | Xenode Admin" };

export default async function CouponsPage() {
  const session = await getAdminSession();
  if (!session || session.role !== "super_admin") redirect("/admin/dashboard");

  await dbConnect();
  const raw = await Coupon.find().sort({ createdAt: -1 }).lean();

  // Serialize for client component
  const coupons = raw.map((c) => ({
    id: c._id.toString(),
    code: c.code,
    type: c.type,
    targetUserId: c.targetUserId ?? null,
    discountType: c.discountType,
    discountValue: c.discountValue,
    maxUses: c.maxUses,
    perUserLimit: c.perUserLimit,
    usedCount: c.usedCount,
    applicablePlans: c.applicablePlans,
    validFrom: c.validFrom.toISOString(),
    validTo: c.validTo.toISOString(),
    isActive: c.isActive,
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-white mb-6">Coupon Codes</h1>
      <CouponManager initialCoupons={coupons} />
    </div>
  );
}
