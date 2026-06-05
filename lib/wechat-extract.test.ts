import { describe, it, expect } from "vitest";
import { normalizeDate } from "./wechat-extract";

describe("normalizeDate", () => {
  it("parses WeChat Chinese date to ISO", () => {
    expect(normalizeDate("2026年02月06日 13:47")).toBe("2026-02-06");
  });
  it("pads single-digit month/day", () => {
    expect(normalizeDate("2026年2月6日")).toBe("2026-02-06");
  });
  it("returns empty string when no date", () => {
    expect(normalizeDate("无日期")).toBe("");
  });
});
