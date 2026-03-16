import type { Metadata } from "next";
import { PhotosGrid } from "@/components/dashboard/PhotosGrid";

export const metadata: Metadata = {
  title: "Photos | Xenode",
  description: "View all your uploaded photos",
};

export default function PhotosPage() {
  return <PhotosGrid />;
}
