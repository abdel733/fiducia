module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.spec.ts"],
  moduleNameMapper: { "^@fiducia/shared$": "<rootDir>/../packages/shared/src/index.ts" },
};