import type { Metadata } from "next";
import { PhotosLanding } from "./components/landing/PhotosLanding";
import { getPhotosProductSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Xenode Photos — Your memories, kept private",
  description:
    "A private, end-to-end encrypted home for the photos and videos that matter.",
};

export default async function PhotosHome() {
  const session = await getPhotosProductSession();
  return <PhotosLanding signedIn={Boolean(session)} />;
}
