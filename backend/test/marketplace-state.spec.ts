import { MarketplaceListingStatus } from "@prisma/client";
import { canTransitionListing } from "../src/marketplace/marketplace.service";

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