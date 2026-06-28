import type { Metadata } from "next";
import { PhotosGrid } from "@/components/dashboard/PhotosGrid";

export const metadata: Metadata = {
  title: "Album | Xenode",
  description: "View photos in an album",
};

export default async function AlbumDetailPage({
  params,
}: {
  params: Promise<{ albumId: string }>;
}) {
  const { albumId } = await params;
  return <PhotosGrid initialViewMode="albums" initialAlbumId={albumId} />;
}
