import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Counter — generic monotonic sequence generator used for invoice numbering
 * and similar gap-free counters scoped by a string key.
 *
 * Each key is independent (e.g. "invoice:2026" → 1, 2, 3, …). Use
 * `nextSequence("invoice:2026")` to atomically increment and read.
 */

export interface ICounter extends Document {
  key: string;
  seq: number;
  updatedAt: Date;
}

const CounterSchema = new Schema<ICounter>(
  {
    key: { type: String, required: true, unique: true, index: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

const Counter: Model<ICounter> =
  mongoose.models.Counter ||
  mongoose.model<ICounter>("Counter", CounterSchema);

export default Counter;

/** Atomically increment the named counter and return the new value. */
export async function nextSequence(key: string): Promise<number> {
  const result = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return result!.seq;
}
