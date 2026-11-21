import { describe, expect, it } from "vitest";
import { planPhones } from "../transmitter/scripts/phones-plan.mjs";

// `npm run phones` (decision 207): reopen the app when only its code changed; build and install
// only after a native change, or for a phone without the app.

const now = new Date("2026-11-21T18:00:00Z");
const ready = { name: "Phone A", udid: "A", connected: true, paired: true, developerMode: "enabled" };
const other = { name: "Phone B", udid: "B", connected: true, paired: true, developerMode: "enabled" };
const state = {
  prebuilt: "n1",
  phones: { A: { name: "Phone A", native: "n1", installedAt: "2026-11-21T09:00:00Z" } },
};
const base = { native: "n1", state, hasNativeProject: true, rebuild: false, installed: { A: true, B: true }, now };

const actions = (plan: ReturnType<typeof planPhones>) => plan.steps.map((s) => `${s.phone.udid}:${s.action}`);

describe("planPhones", () => {
  it("only reopens the app when nothing native changed", () => {
    const plan = planPhones({ ...base, phones: [ready] });
    expect(plan.prebuild).toBeNull();
    expect(actions(plan)).toEqual(["A:open"]);
    expect(plan.steps[0].days).toBe(0);
  });

  it("makes ios/ again and rebuilds every phone after a native change", () => {
    const plan = planPhones({ ...base, native: "n2", phones: [ready, other] });
    expect(plan.prebuild).toMatch(/native side changed/);
    expect(actions(plan)).toEqual(["A:install", "B:install"]);
  });

  it("makes ios/ on the first run and when the folder is missing", () => {
    expect(planPhones({ ...base, state: {}, phones: [ready] }).prebuild).toMatch(/first run/);
    expect(planPhones({ ...base, hasNativeProject: false, phones: [ready] }).prebuild).toMatch(/no ios/);
  });

  it("installs on a phone that does not have the app, and only reopens the others", () => {
    const plan = planPhones({ ...base, installed: { A: true, B: false }, phones: [ready, other] });
    expect(plan.prebuild).toBeNull();
    expect(actions(plan)).toEqual(["A:open", "B:install"]);
  });

  it("installs again on a phone whose copy it did not record", () => {
    const plan = planPhones({ ...base, phones: [other] });
    expect(actions(plan)).toEqual(["B:install"]);
    expect(plan.steps[0].reason).toMatch(/older native build/);
  });

  it("rebuilds on --rebuild without making ios/ again", () => {
    const plan = planPhones({ ...base, rebuild: true, phones: [ready] });
    expect(plan.prebuild).toBeNull();
    expect(actions(plan)).toEqual(["A:install"]);
  });

  it("skips phones it cannot reach or install on, and then makes nothing", () => {
    const phones = [
      { ...ready, udid: "C", connected: false },
      { ...ready, udid: "D", paired: false },
      { ...ready, udid: "E", developerMode: "disabled" },
    ];
    const plan = planPhones({ ...base, native: "n2", phones });
    expect(actions(plan)).toEqual(["C:skip", "D:skip", "E:skip"]);
    expect(plan.steps.map((s) => s.reason)).toEqual([
      expect.stringMatching(/not connected/),
      expect.stringMatching(/Trust/),
      expect.stringMatching(/Developer Mode/),
    ]);
    expect(plan.prebuild).toBeNull();
  });

  it("counts the days since the install, for the 7-day free signing", () => {
    const plan = planPhones({ ...base, now: new Date("2026-11-27T10:00:00Z"), phones: [ready] });
    expect(plan.steps[0].days).toBe(6);
  });
});
