import { afterEach, describe, expect, it } from "vitest";
import { getPublicB2Url } from "@/lib/b2/cdn";

const previous = process.env.PUBLIC_S3_ENDPOINT;
afterEach(() => {
  if (previous === undefined) delete process.env.PUBLIC_S3_ENDPOINT;
  else process.env.PUBLIC_S3_ENDPOINT = previous;
});

describe("public R2 asset origin", () => {
  it("uses only the configured public origin and encodes key segments", () => {
    process.env.PUBLIC_S3_ENDPOINT = "https://assets.example.test";
    expect(getPublicB2Url("public-bucket", "avatars/a b.svg"))
      .toBe("https://assets.example.test/avatars/a%20b.svg");
  });

  it("fails closed without an HTTPS public origin", () => {
    delete process.env.PUBLIC_S3_ENDPOINT;
    expect(() => getPublicB2Url("public-bucket", "file")).toThrow(/PUBLIC_S3_ENDPOINT/);
    process.env.PUBLIC_S3_ENDPOINT = "http://assets.example.test";
    expect(() => getPublicB2Url("public-bucket", "file")).toThrow(/HTTPS public origin/);
  });
});
