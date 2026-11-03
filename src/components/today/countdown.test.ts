import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountdownFigure, countStart } from "./countdown";

describe("Today countdown", () => {
  it("doesn't count on the exam day: there is no run of numbers leading to 'Today'", () => {
    expect(countStart(0)).toBeNull();
  });

  it("never counts a day already past", () => {
    expect(countStart(-1)).toBeNull();
  });

  it("counts down from 15 above the real figure on other days", () => {
    expect(countStart(1)).toBe(16);
    expect(countStart(4)).toBe(19);
    expect(countStart(120)).toBe(135);
  });

  it("first renders the real figure, so nothing but it is ever shown before the effect decides", () => {
    expect(renderToStaticMarkup(createElement(CountdownFigure, { days: 0, playKey: "1:2026-11-03" }))).toMatch(/^<span[^>]*>Today<\/span>$/);
    expect(renderToStaticMarkup(createElement(CountdownFigure, { days: 4, playKey: "1:2026-11-03", markClass: "mark" }))).toBe(
      '<span class="mark">4</span>',
    );
  });
});
