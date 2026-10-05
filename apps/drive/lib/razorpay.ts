import Razorpay from "razorpay";

let client: Razorpay | undefined;

/** Builds never see payment secrets: the client is created on first use. */
export function getRazorpayClient(): Razorpay {
  if (client) return client;
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error(
      "RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is not defined in environment variables.",
    );
  }
  client = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  return client;
}

const razorpay = {
  get subscriptions() {
    return getRazorpayClient().subscriptions;
  },
  get payments() {
    return getRazorpayClient().payments;
  },
  get plans() {
    return getRazorpayClient().plans;
  },
};

export default razorpay;
