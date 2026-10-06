import { describe, expect, it } from "vitest";
import { beninPhoneSchema, calculateTaeg, formatXof, getImeiTac, isValidImei, maskImei, normalizeImei } from "../src";

describe("shared validation and money helpers", () => {
  it("accepts only Benin E.164 phone numbers", () => {
    expect(beninPhoneSchema.safeParse("+22997000000").success).toBe(true);
    expect(beninPhoneSchema.safeParse("97000000").success).toBe(false);
  });

  it("validates IMEI with Luhn and formats integer XOF", () => {
    expect(isValidImei("490154203237518")).toBe(true);
    expect(isValidImei("490154203237519")).toBe(false);
    expect(normalizeImei(" 4901-5420-3237-518 ")).toBe("490154203237518");
    expect(getImeiTac("490154203237518")).toBe("49015420");
    expect(maskImei("490154203237518")).toBe("49015420323****");
    expect(formatXof(125000)).toContain("125");
  });

  it("computes a non-negative effective annual rate", () => {
    expect(calculateTaeg(120000, 100000, 12, 12)).toBe(20);
    expect(() => calculateTaeg(9, 10, 12, 12)).toThrow(RangeError);
  });
});