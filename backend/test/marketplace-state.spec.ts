import { MarketplaceListingStatus } from "@prisma/client";
import { canTransitionListing, getTrustedReportSeverity, shouldReleaseListingImei } from "../src/marketplace/marketplace.service";

describe("Marketplace listing state machine", () => {
  it.each([
    ["DRAFT", "PENDING_REVIEW", true],
    ["DRAFT", "PUBLISHED", false],
    ["PENDING_REVIEW", "PUBLISHED", true],
    ["PUBLISHED", "RESERVED", true],
    ["RESERVED", "SOLD", true],
    ["PUBLISHED", "SUSPENDED", true],
    ["SUSPENDED", "PENDING_REVIEW", true],
    ["SOLD", "PUBLISHED", false],
    ["WITHDRAWN", "PUBLISHED", false],
    ["EXPIRED", "RESERVED", false],
  ])("allows %s → %s: %s", (from, to, expected) => {
    expect(canTransitionListing(from as MarketplaceListingStatus, to as MarketplaceListingStatus)).toBe(expected);
  });
});

describe("Marketplace listing IMEI lock", () => {
  it.each([
    ["PUBLISHED", true],
    ["RESERVED", true],
    ["PENDING_REVIEW", false],
    ["DRAFT", false],
    ["SUSPENDED", false],
    ["SOLD", false],
    ["WITHDRAWN", false],
    ["EXPIRED", false],
  ])("releases the IMEI lock for %s: %s", (status, expected) => {
    expect(shouldReleaseListingImei(status as MarketplaceListingStatus)).toBe(expected);
  });
});

describe("Marketplace report severity", () => {
  it("does not trust severity supplied by a public reporter", () => {
    expect(getTrustedReportSeverity("CRITICAL", ["BUYER"])).toBe("MEDIUM");
  });

  it("allows trusted agents to classify urgent reports", () => {
    expect(getTrustedReportSeverity("CRITICAL", ["AGENT"])).toBe("CRITICAL");
  });
});