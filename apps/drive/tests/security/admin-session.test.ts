import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT, jwtVerify } from "jose";
import { NextRequest } from "next/server";
import { Admin, type AdminRecord, type DatabaseDocument } from "@xenode/database";
import bcrypt from "bcryptjs";

const { jar } = vi.hoisted(() => ({ jar: {
  store: new Map<string, string>(),
  get(name: string) { const value = this.store.get(name); return value ? { value } : undefined; },
  set(name: string, value: string) { this.store.set(name, value); },
  delete(name: string) { this.store.delete(name); },
} }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));
import { createAdminSession, getAdminSession, getAdminSessionFromRequest, requireSuperAdminSession } from "@/lib/admin/session";
import { PATCH, DELETE } from "@/app/api/admin/admins/[adminId]/route";
import { GET as me } from "@/app/api/admin/me/route";
import { POST as login } from "@/app/api/admin/login/route";
import { ensureSuperAdmin } from "@/lib/admin/ensureSuperAdmin";

const cookieName = "Xenode_admin_session";
const secret = "synthetic-admin-session-secret-only-0001";
const origin = "https://admin.example.test";
const password = "synthetic-admin-password";
let passwordHash: string;
let operator: DatabaseDocument<AdminRecord>;

beforeAll(async () => {
  await Admin.init();
  passwordHash = await bcrypt.hash(password, 4);
});
beforeEach(async () => {
  vi.stubEnv("ADMIN_JWT_SECRET", secret);
  vi.stubEnv("ADMIN_USERNAME", "");
  vi.stubEnv("ADMIN_PASSWORD", "");
  jar.store.clear();
  operator = await Admin.create({ username: "operator", passwordHash, role: "super_admin", isActive: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  jar.store.clear();
});

function tokenRequest(token: string) {
  return new NextRequest(`${origin}/api/admin/me`, { headers: { cookie: `${cookieName}=${token}` } });
}
function patchRequest(body: object) {
  return new NextRequest(`${origin}/api/admin/admins/target`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function target(id: string) { return { params: Promise.resolve({ adminId: id }) }; }
function useToken(token: string) { jar.set(cookieName, token); }
async function mint(admin = operator) {
  return createAdminSession({ id: admin._id.toString(), sessionVersion: admin.sessionVersion });
}
async function sign(overrides: Record<string, unknown> = {}, alg = "HS256", typ = "JWT") {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ id: operator._id.toString(), username: "untrusted-token-label", role: operator.role,
    sessionVersion: 1, iss: "xenode-drive-admin", aud: "xenode-admin", iat: now, exp: now + 28800, ...overrides })
    .setProtectedHeader({ alg, typ }).sign(new TextEncoder().encode(secret));
}

describe("current Admin authority", () => {
  it("seed settings do not restore a disabled/demoted operator", async () => {
    await Admin.updateOne({ _id: operator._id }, { $set: { role: "admin", isActive: false } });
    vi.stubEnv("ADMIN_USERNAME", operator.username);
    vi.stubEnv("ADMIN_PASSWORD", password);
    const lookup = vi.spyOn(Admin, "findOne");
    await ensureSuperAdmin();
    expect(lookup).toHaveBeenCalled();
    expect(await Admin.findById(operator._id).lean()).toMatchObject({ isActive: false, role: "admin" });
    expect(await Admin.countDocuments()).toBe(1);
  });
  it("issues a scoped versioned JWT and resolves current database identity through both readers", async () => {
    const token = await mint();
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    expect(payload).toMatchObject({ iss: "xenode-drive-admin", aud: "xenode-admin", sessionVersion: 1 });
    expect(await getAdminSession()).toEqual({ id: operator._id.toString(), username: "operator", role: "super_admin", sessionVersion: 1 });
    expect(await getAdminSessionFromRequest(tokenRequest(token))).toEqual(await getAdminSession());
    expect((await me()).status).toBe(200);
    const raw = await Admin.findById(operator._id).lean();
    expect(raw).not.toHaveProperty("passwordHash");
  });

  it.each(["disable", "delete", "demote", "version-change"])("rejects a still-unexpired token after %s", async (change) => {
    const token = await mint();
    if (change === "disable") await Admin.updateOne({ _id: operator._id }, { $set: { isActive: false } });
    if (change === "delete") await Admin.deleteOne({ _id: operator._id });
    if (change === "demote") await Admin.updateOne({ _id: operator._id }, { $set: { role: "admin" } });
    if (change === "version-change") await Admin.updateOne({ _id: operator._id }, { $inc: { sessionVersion: 1 } });
    expect(await getAdminSession()).toBeNull();
    expect(await getAdminSessionFromRequest(tokenRequest(token))).toBeNull();
    expect((await me()).status).toBe(401);
    await expect(requireSuperAdminSession()).rejects.toThrow("Unauthorized");
  });

  it("disable/re-enable cannot resurrect an old token; a fresh credential login succeeds", async () => {
    const actorToken = await mint();
    const admin = await Admin.create({ username: "target_admin", passwordHash, role: "admin", isActive: true });
    const oldToken = await mint(admin);
    useToken(actorToken);
    const disabled = await PATCH(patchRequest({ isActive: false }), target(admin._id.toString()));
    expect(disabled.status).toBe(200);
    expect((await disabled.json()).admin).not.toHaveProperty("passwordHash");
    useToken(oldToken);
    expect(await getAdminSession()).toBeNull();
    useToken(actorToken);
    expect((await PATCH(patchRequest({ isActive: true }), target(admin._id.toString()))).status).toBe(200);
    useToken(oldToken);
    expect(await getAdminSession()).toBeNull();
    const response = await login(new NextRequest(`${origin}/api/admin/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: admin.username, password }),
    }));
    expect(response.status).toBe(200);
    expect(await getAdminSession()).toMatchObject({ username: admin.username, role: "admin", sessionVersion: 3 });
  });

  it("a demoted operator cannot use its old token to change or delete another Admin", async () => {
    const actorToken = await mint();
    const admin = await Admin.create({ username: "other_operator", passwordHash, role: "super_admin" });
    const oldToken = await mint(admin);
    useToken(actorToken);
    expect((await PATCH(patchRequest({ role: "admin" }), target(admin._id.toString()))).status).toBe(200);
    useToken(oldToken);
    expect((await PATCH(patchRequest({ isActive: false }), target(operator._id.toString()))).status).toBe(403);
    expect((await DELETE(tokenRequest(oldToken), target(operator._id.toString()))).status).toBe(403);
    expect((await Admin.findById(operator._id).lean())?.isActive).toBe(true);
    const changed = await Admin.findById(admin._id);
    await mint(changed!);
    await expect(requireSuperAdminSession()).rejects.toThrow("Forbidden");
    expect((await PATCH(patchRequest({ isActive: false }), target(operator._id.toString()))).status).toBe(403);
  });

  it("deletion through the API invalidates the removed Admin's token and refuses self deletion", async () => {
    const actorToken = await mint();
    const admin = await Admin.create({ username: "delete_target", passwordHash, role: "admin" });
    const oldToken = await mint(admin);
    useToken(actorToken);
    expect((await DELETE(tokenRequest(actorToken), target(operator._id.toString()))).status).toBe(400);
    expect((await DELETE(tokenRequest(actorToken), target(admin._id.toString()))).status).toBe(200);
    useToken(oldToken);
    expect((await me()).status).toBe(401);
  });

  it("concurrent security updates each advance the session version", async () => {
    const actorToken = await mint();
    const admin = await Admin.create({ username: "target_admin", passwordHash, role: "super_admin" });
    const oldToken = await mint(admin);
    useToken(actorToken);
    const responses = await Promise.all([
      PATCH(patchRequest({ role: "admin" }), target(admin._id.toString())),
      PATCH(patchRequest({ isActive: false }), target(admin._id.toString())),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await Admin.findById(admin._id).lean()).toMatchObject({ role: "admin", isActive: false, sessionVersion: 3 });
    useToken(oldToken);
    expect(await getAdminSession()).toBeNull();
  });

  it("does not mint a cookie after credentials were checked against a stale security version", async () => {
    await Admin.updateOne({ _id: operator._id }, { $inc: { sessionVersion: 1 } });
    await expect(mint()).rejects.toThrow("credentials changed");
    expect(jar.store.size).toBe(0);
  });

  it.each([
    ["wrong issuer", { iss: "accounts-authority" }],
    ["wrong audience", { aud: "xenode-drive" }],
    ["missing version", { sessionVersion: undefined }],
    ["fractional version", { sessionVersion: 1.5 }],
    ["missing expiry", { exp: undefined }],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 1 }],
    ["excess lifetime", { exp: Math.floor(Date.now() / 1000) + 86400 }],
    ["future issue time", { iat: Math.floor(Date.now() / 1000) + 3600 }],
    ["invalid identity", { id: "not-an-admin-id" }],
    ["invalid role", { role: "owner" }],
  ])("rejects a signed token with %s", async (_name, claims) => {
    useToken(await sign(claims as Record<string, unknown>));
    expect(await getAdminSession()).toBeNull();
  });

  it("rejects unsupported algorithms and token types", async () => {
    useToken(await sign({}, "HS384"));
    expect(await getAdminSession()).toBeNull();
    useToken(await sign({}, "HS256", "other-credential"));
    expect(await getAdminSession()).toBeNull();
  });

  it("fails closed if the authoritative Admin lookup fails", async () => {
    await mint();
    vi.spyOn(Admin, "findOne").mockImplementationOnce(() => { throw new Error("database unavailable"); });
    expect(await getAdminSession()).toBeNull();
  });

  it("requires an explicit signing secret", async () => {
    vi.stubEnv("ADMIN_JWT_SECRET", "");
    await expect(mint()).rejects.toThrow("ADMIN_JWT_SECRET");
    expect(jar.store.size).toBe(0);
  });

});
