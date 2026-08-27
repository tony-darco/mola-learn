/** Shared constants for the e2e suite — seeded accounts, storage-state paths. */

export const ALICE = { email: "alice@umbc.edu", password: "mola-dev-password" };
export const BOB = { email: "bob@umbc.edu", password: "mola-dev-password" };

export const ALICE_STORAGE = "e2e/.auth/alice.json";
export const BOB_STORAGE = "e2e/.auth/bob.json";

/** A fully signed-out browser context, for the anonymous-access specs. */
export const SIGNED_OUT_STORAGE = { cookies: [], origins: [] };

/** Titles of the fixtures `global-setup.ts` seeds directly into the DB. */
export const FLICKER_CHAT_A = "E2E Flicker A";
export const FLICKER_CHAT_B = "E2E Flicker B";
export const COMPACTION_CHAT = "E2E Compaction Demo";

/** Forbidden per Layer 4 / CONTRACTS.md "Resolved — the model announced the hint rung." */
export const FORBIDDEN_RUNG_NAMES = [/pointing hint/i, /teaching hint/i, /bottom-out hint/i, /bottom_out hint/i];
