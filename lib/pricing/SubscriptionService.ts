import { ClientSession } from "mongoose";
import Subscription from "@/models/Subscription";
import { IPendingTransaction } from "@/models/PendingTransaction";

export default class SubscriptionService {
  /**
   * Creates or updates the Subscription model fallback for backward compatibility.
   */
  static async createOrUpdateSubscription(
    userId: string,
    pending: IPendingTransaction,
    startDate: Date,
    endDate: Date,
    authpayuid: string | null,
    txnid: string,
    session: ClientSession
  ) {
    return Subscription.findOneAndUpdate(
      { userId },
      {
        $set: {
          planSlug: pending.planSlug,
          status: "active",
          billingCycle: pending.billingCycle ?? "monthly",
          startDate,
          endDate,
          autoRenew: !!authpayuid,
          metadata: {
            lastTxnid: txnid,
            paymentMethod: pending.paymentMethod,
          }
        }
      },
      { upsert: true, session }
    );
  }

  /**
   * Expires subscriptions that are past their end date.
   */
  static async expirePastDueSubscriptions(now: Date = new Date()) {
    return Subscription.updateMany(
      {
        status: "active",
        endDate: { $lt: now },
      },
      {
        $set: {
          status: "expired"
        }
      }
    );
  }
}
