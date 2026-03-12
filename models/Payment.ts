import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPayment extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  amount: number;
  currency: string;
  status: "success" | "pending" | "failed";
  txnid: string;
  planName: string;
  payuResponse?: any; // To store raw response for auditing
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    userId: {
      type: String,
      required: [true, "User ID is required"],
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "INR",
    },
    status: {
      type: String,
      enum: ["success", "pending", "failed"],
      default: "pending",
      index: true,
    },
    txnid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    planName: {
      type: String,
      required: true,
    },
    payuResponse: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

const Payment: Model<IPayment> =
  mongoose.models.Payment || mongoose.model<IPayment>("Payment", PaymentSchema);

export default Payment;
