import mongoose, { Schema, Document, Model } from "mongoose";

export interface IWaitlist extends Document {
  email: string;
  createdAt: Date;
  source?: string;
}

const WaitlistSchema = new Schema<IWaitlist>(
  {
    email: {
      type: String,
      required: [true, "Email is required"],
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    source: {
      type: String,
      default: "landing-page",
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Indexes
 *
 * - email: unique – prevents duplicate signups and serves the
 *          findOne({ email }) lookup on submission
 */
WaitlistSchema.index({ email: 1 }, { unique: true });

// Prevent model recompilation in development
const Waitlist: Model<IWaitlist> =
  mongoose.models.Waitlist ||
  mongoose.model<IWaitlist>("Waitlist", WaitlistSchema);

export default Waitlist;
