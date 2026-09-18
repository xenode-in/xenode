export const MAX_PROFILE_IMAGE_LENGTH = 24_000;
export const DICEBEAR_LORELEI_ORIGIN = "https://api.dicebear.com";

export function isValidProfileImage(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PROFILE_IMAGE_LENGTH
  ) {
    return false;
  }
  if (/^data:image\/(svg\+xml|png|jpeg|webp)[,;]/u.test(value)) return true;
  try {
    const url = new URL(value);
    const parameters = [...url.searchParams.keys()];
    return (
      url.origin === DICEBEAR_LORELEI_ORIGIN &&
      url.pathname === "/10.x/lorelei/svg" &&
      parameters.length === 1 &&
      parameters[0] === "seed" &&
      Boolean(url.searchParams.get("seed"))
    );
  } catch {
    return false;
  }
}
