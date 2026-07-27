export type PhotosSessionInfo = {
  accountId: string;
  spaceId: string;
  productId: "photos";
};

let activeRequest: Promise<PhotosSessionInfo> | null = null;

/**
 * Share one in-flight Photos session request across client consumers.
 *
 * PhotosKeyAccess and PhotosApp both need the same session during bootstrap.
 * Caching the promise prevents duplicate calls under React Strict Mode and
 * protects the API from accidental render/effect request storms.
 */
export function getClientPhotosSession(): Promise<PhotosSessionInfo> {
  if (activeRequest) return activeRequest;

  activeRequest = fetch("/api/session", {
    credentials: "include",
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("Sign in to Photos first.");
      return (await response.json()) as PhotosSessionInfo;
    })
    .catch((error: unknown) => {
      activeRequest = null;
      throw error;
    });

  return activeRequest;
}
