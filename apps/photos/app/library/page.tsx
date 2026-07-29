import { redirect } from "next/navigation";
import { PhotosApp } from "../components/PhotosApp";
import { PhotosKeyAccess } from "../components/PhotosKeyAccess";
import { getPhotosProductSession } from "@/lib/session";

export const metadata = {
  title: "Library — Xenode Photos",
};

export default async function PhotosLibraryPage() {
  const session = await getPhotosProductSession();
  if (!session) redirect("/auth/login?next=/library");

  return (
    <PhotosKeyAccess>
      <PhotosApp />
    </PhotosKeyAccess>
  );
}
