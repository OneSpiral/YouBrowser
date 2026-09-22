import { describe, expect, test } from "bun:test";
import { parseCaptureContract, parseContract } from "../src/schema.js";

const valid = {
  version: 1,
  target: { kind: "web", baseUrl: "https://example.com" },
  scenarios: [{ id: "desktop" }],
  checks: [{ id: "status", type: "status", equals: 200, severity: "must" }],
};

describe("acceptance contract", () => {
  test("accepts a bounded contract with a must check", () => {
    expect(parseContract(valid).version).toBe(1);
  });

  test("rejects empty verification", () => {
    expect(() =>
      parseContract({
        ...valid,
        checks: [],
      }),
    ).toThrow("at least one check");
  });

  test("rejects contracts with no required acceptance criterion", () => {
    expect(() =>
      parseContract({
        ...valid,
        checks: [{ id: "console", type: "console", maxErrors: 0, severity: "should" }],
      }),
    ).toThrow("at least one must");
  });

  test("allows capture without acceptance checks", () => {
    const captured = parseCaptureContract({
      version: 1,
      target: { kind: "http", baseUrl: "https://example.com" },
      scenarios: [{ id: "dataset", path: "/data.json" }],
    });
    expect(captured.target.kind).toBe("http");
  });

  test("rejects acceptance checks in capture mode", () => {
    expect(() =>
      parseCaptureContract(valid),
    ).toThrow("do not accept checks");
  });

  test("rejects checks scoped to an unknown scenario", () => {
    expect(() =>
      parseContract({
        ...valid,
        checks: [
          {
            id: "status",
            type: "status",
            equals: 200,
            severity: "must",
            scenarios: ["missing"],
          },
        ],
      }),
    ).toThrow("unknown scenario");
  });
});
