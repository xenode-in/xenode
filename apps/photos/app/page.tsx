import { PhotosApp } from "./components/PhotosApp";
import { PhotosKeyAccess } from "./components/PhotosKeyAccess";

export default function PhotosHome() {
  return (
    <PhotosKeyAccess>
      <PhotosApp />
    </PhotosKeyAccess>
  );
}
