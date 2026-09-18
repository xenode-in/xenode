import { describe, expect, it } from "vitest";
import {
  MAX_PROFILE_IMAGE_LENGTH,
  isValidProfileImage,
} from "../lib/profile-image";
import { loreleiAvatarUrl } from "../components/onboarding/avatars";

describe("profile image validation", () => {
  it("builds Lorelei URLs with only the seed parameter", () => {
    expect(loreleiAvatarUrl("7a91f2")).toBe(
      "https://api.dicebear.com/10.x/lorelei/svg?seed=7a91f2",
    );
  });

  it("accepts Lorelei URLs with an opaque seed", () => {
    expect(
      isValidProfileImage(
        "https://api.dicebear.com/10.x/lorelei/svg?seed=7a91f2",
      ),
    ).toBe(true);
  });

  it("rejects other remote providers, styles, and rendering parameters", () => {
    expect(isValidProfileImage("https://example.com/avatar.png")).toBe(false);
    expect(
      isValidProfileImage(
        "https://api.dicebear.com/10.x/bottts/svg?seed=7a91f2",
      ),
    ).toBe(false);
    expect(
      isValidProfileImage(
        "https://api.dicebear.com/10.x/lorelei/svg?seed=7a91f2&radius=18",
      ),
    ).toBe(false);
  });

  it("accepts bounded image data and rejects oversized values", () => {
    expect(isValidProfileImage("data:image/jpeg;base64,AA==")).toBe(true);
    expect(
      isValidProfileImage(
        `data:image/png;base64,${"A".repeat(MAX_PROFILE_IMAGE_LENGTH)}`,
      ),
    ).toBe(false);
  });
});
