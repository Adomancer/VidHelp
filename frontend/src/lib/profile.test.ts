import { describe, expect, it } from "vitest";
import { changedPersonalFields } from "./profile";

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const saved = { name: "Ayu Lestari", host: { phone: "0812-7770-0003", guardian_phone: "081377700003" } };

describe("changedPersonalFields", () => {
  it("sends nothing when nothing was edited (phones compared as digits)", () => {
    expect(changedPersonalFields(form({ name: "Ayu Lestari", phone: "081277700003", guardian_phone: "081377700003" }), saved)).toEqual({});
  });

  it("sends only the edited field, so a pending change to another one stays", () => {
    expect(changedPersonalFields(form({ name: "Ayu Lestari", phone: "081277700003", guardian_phone: "081299998888" }), saved)).toEqual({
      guardian_phone: "081299998888",
    });
  });

  it("sends a cleared field as null", () => {
    expect(changedPersonalFields(form({ name: "Ayu Lestari", phone: "081277700003", guardian_phone: "" }), saved)).toEqual({ guardian_phone: null });
  });
});
