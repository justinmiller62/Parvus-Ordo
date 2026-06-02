import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppIdentity } from "../platform/identity";
import { lookupAppUser } from "../platform/identity";
import type { AppLoginResult } from "./password";
import { authenticateWithCode, authenticateWithPassword } from "./password";

// --- Type-level regression (po-4pg) ---
// The login result is shared by BOTH login paths, so it carries a generic name
// (AppLoginResult), not a "Password"-prefixed one. These compile-time checks fail
// `pnpm typecheck` if the exported name is missing or the two return signatures drift
// apart. Erased at runtime, so vitest sees nothing here.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
type LoginOf<F extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<F>>;

type _PasswordPathReturnsAppLogin = Assert<Equal<LoginOf<typeof authenticateWithPassword>, AppLoginResult | null>>;
type _CodePathReturnsAppLogin = Assert<Equal<LoginOf<typeof authenticateWithCode>, AppLoginResult | null>>;

// lookupAppUser hits the DB (login_lookup) — stub it so these stay unit-level, and
// so we can assert the unverified, client-supplied email NEVER reaches the lookup.
vi.mock("../platform/identity", () => ({ lookupAppUser: vi.fn() }));
const mockLookup = vi.mocked(lookupAppUser);

// Model the WorkOS /authenticate response: `ok` drives accept/reject, and on success
// `email` is the VERIFIED address WorkOS returns (which may differ from what the
// client posted). fetch is stubbed per-test rather than hitting the network.
function stubWorkos(response: { ok: boolean; email?: string }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: response.ok,
      json: async () => ({ user: response.email ? { email: response.email } : undefined }),
    })),
  );
}

const IDENTITY: AppIdentity = {
  userId: "u-1",
  displayName: "Verified User",
  isSuperAdmin: false,
  role: "parish_member",
  parishId: "parish-1",
  memberships: [{ parishId: "parish-1", parishName: "St. Example", parishHostname: null, role: "parish_member" }],
};

describe("authenticateWithPassword", () => {
  beforeEach(() => {
    // workosAuthenticate throws if these are unset, before it ever reaches fetch.
    vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
    vi.stubEnv("WORKOS_API_KEY", "sk_test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // REGRESSION (po-7my): when WorkOS REJECTS the credentials, login must fail closed —
  // return null (the route maps this to HTTP 401) and never look the user up. The old
  // `resolveLogin(verified ?? email)` fell back to the unverified request-body email,
  // minting a 30-day token for any parish-member email + ANY password (account takeover).
  it("returns null and never looks up the user when WorkOS rejects the credentials", async () => {
    stubWorkos({ ok: false });

    const result = await authenticateWithPassword("victim@parish.org", "wrong-password");

    expect(result).toBeNull();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("resolves the login from the WorkOS-verified email on success", async () => {
    stubWorkos({ ok: true, email: "verified@parish.org" });
    mockLookup.mockResolvedValue(IDENTITY);

    const result = await authenticateWithPassword("verified@parish.org", "correct-password");

    expect(mockLookup).toHaveBeenCalledWith("verified@parish.org");
    expect(result).toEqual({
      userId: "u-1",
      email: "verified@parish.org",
      displayName: "Verified User",
      parishId: "parish-1",
    });
  });

  // Never trust the request body past verification: even on a successful auth the login
  // is resolved from WorkOS's returned email, not whatever the client happened to post.
  it("uses the WorkOS-verified email, not the client-supplied email, to resolve the login", async () => {
    stubWorkos({ ok: true, email: "canonical@parish.org" });
    mockLookup.mockResolvedValue(IDENTITY);

    await authenticateWithPassword("attacker-typed@parish.org", "correct-password");

    expect(mockLookup).toHaveBeenCalledWith("canonical@parish.org");
    expect(mockLookup).not.toHaveBeenCalledWith("attacker-typed@parish.org");
  });

  // A verified user with no parish membership (lookup returns null) is not a valid app
  // login — fail closed rather than minting a token with no parish scope.
  it("returns null when the verified user has no parish membership", async () => {
    stubWorkos({ ok: true, email: "verified@parish.org" });
    mockLookup.mockResolvedValue(null);

    const result = await authenticateWithPassword("verified@parish.org", "correct-password");

    expect(result).toBeNull();
  });
});

// po-4pg: the authorization_code / Google path resolves to the SAME shape as the
// password path — one shared AppLoginResult, which is why the type is not named for
// passwords. (Also the first runtime coverage for authenticateWithCode.)
describe("authenticateWithCode", () => {
  beforeEach(() => {
    vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
    vi.stubEnv("WORKOS_API_KEY", "sk_test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("resolves a login from the WorkOS-verified email to the shared AppLoginResult shape", async () => {
    stubWorkos({ ok: true, email: "verified@parish.org" });
    mockLookup.mockResolvedValue(IDENTITY);

    const result = await authenticateWithCode("auth-code-123");

    expect(mockLookup).toHaveBeenCalledWith("verified@parish.org");
    expect(result).toEqual({
      userId: "u-1",
      email: "verified@parish.org",
      displayName: "Verified User",
      parishId: "parish-1",
    });
  });
});
