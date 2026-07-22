import { describe, expect, it } from "vitest";
import {
  auditActionLabel,
  bytesLabel,
  resumeAuthorizationPath,
  usagePercent,
} from "../lib/presentation";

describe("Accounts presentation helpers", () => {
  it("renders known and future audit actions without exposing metadata", () => {
    expect(auditActionLabel("vault.created")).toBe("Created encrypted Vault");
    expect(auditActionLabel("organization.member_added")).toBe(
      "Organization member added",
    );
  });

  it("formats byte-only usage and clamps progress", () => {
    expect(bytesLabel(1536)).toBe("1.5 KB");
    expect(bytesLabel(null)).toBe("Unlimited");
    expect(usagePercent(75, 100)).toBe(75);
    expect(usagePercent(150, 100)).toBe(100);
    expect(usagePercent(10, null)).toBe(0);
  });

  it("resumes only allowlisted OIDC authorization parameters", () => {
    const query = new URLSearchParams({
      client_id: "xenode-drive-web",
      redirect_uri: "https://drive.xenode.in/auth/callback",
      response_type: "code",
      state: "safe-state",
      unexpected: "javascript:alert(1)",
    });
    const result = resumeAuthorizationPath(query);
    expect(result).toContain("client_id=xenode-drive-web");
    expect(result).toContain("state=safe-state");
    expect(result).not.toContain("unexpected");
    expect(result.startsWith("/api/auth/oauth2/authorize?")).toBe(true);
  });
});
