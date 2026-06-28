import type { Metadata } from "next";
import { PhotosGrid } from "@/components/dashboard/PhotosGrid";

export const metadata: Metadata = {
  title: "Albums | Xenode",
  description: "Organize your photos into albums",
};

export default function AlbumsPage() {
  return <PhotosGrid initialViewMode="albums" />;
}
