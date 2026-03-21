import mongoose, { Schema, Document, Model } from "mongoose";

export interface IBlog extends Document {
  slug: string;
  title: string;
  description: string;
  date: Date;
  author: string;
  tags: string[];
  content: string;
  image?: string;
  folder?: string;
  readingTime: string;
  createdAt: Date;
  updatedAt: Date;
}

const BlogSchema = new Schema<IBlog>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: "",
    },
    date: {
      type: Date,
      default: Date.now,
    },
    author: {
      type: String,
      default: "Xenode Team",
    },
    tags: {
      type: [String],
      default: [],
    },
    content: {
      type: String,
      required: true,
    },
    image: {
      type: String,
    },
    folder: {
      type: String,
    },
    readingTime: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for searching/filtering
BlogSchema.index({ folder: 1 });
BlogSchema.index({ tags: 1 });
BlogSchema.index({ date: -1 });

const Blog: Model<IBlog> =
  mongoose.models.Blog || mongoose.model<IBlog>("Blog", BlogSchema);

export default Blog;
