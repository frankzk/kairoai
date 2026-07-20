import { describe, expect, it } from "vitest";
import { normalizePhone, maskPhone, CR_PHONE, HN_PHONE } from "../lib/phone-cr";

describe("normalizePhone (Costa Rica)", () => {
  it("keeps a well-formed 506 number", () => {
    expect(normalizePhone("50661234567")).toBe("50661234567");
  });
  it("adds 506 to an 8-digit mobile starting in 6/7/8", () => {
    expect(normalizePhone("61234567")).toBe("50661234567");
    expect(normalizePhone("71234567")).toBe("50671234567");
    expect(normalizePhone("81234567")).toBe("50681234567");
  });
  it("strips formatting and the 00 international prefix", () => {
    expect(normalizePhone("+506 6123-4567")).toBe("50661234567");
    expect(normalizePhone("0050661234567")).toBe("50661234567");
  });
  it("rejects 8-digit numbers with an invalid mobile prefix", () => {
    expect(normalizePhone("11234567")).toBeNull();
    expect(normalizePhone("51234567")).toBeNull();
  });
  it("rejects garbage and empty input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
  });
});

describe("normalizePhone (Honduras)", () => {
  it("adds 504 to an 8-digit mobile", () => {
    expect(normalizePhone("91234567", HN_PHONE)).toBe("50491234567");
  });
  it("does not misclassify HN under the CR config", () => {
    // 9XXXXXXXX is invalid for CR (prefixes 6/7/8) but valid for HN.
    expect(normalizePhone("91234567", CR_PHONE)).toBeNull();
  });
});

describe("maskPhone", () => {
  it("keeps country prefix and last 4, masks the middle", () => {
    expect(maskPhone("50661234567")).toBe("506####4567");
  });
});
