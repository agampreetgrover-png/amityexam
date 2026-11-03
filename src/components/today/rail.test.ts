import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExamCalendar } from "./rail";

// November 2026 starts on a Sunday, so its first week shows 26-31 October before it.
const html = renderToStaticMarkup(createElement(ExamCalendar, { today: "2026-11-03", exams: [], subjects: [] }));
const day = (n: number) => new RegExp(`<span class="([^"]*)">${n}</span>`, "g");

describe("exam calendar", () => {
  it("shows the other months' days in --faint at full strength (4.5:1), not faded below it", () => {
    for (const n of [26, 27, 28, 29, 30, 31]) {
      const classes = [...html.matchAll(day(n))].map((m) => m[1]);
      expect(classes.length).toBeGreaterThan(0);
      // The first match is October's (it comes first in the grid).
      expect(classes[0]).toMatch(/\btext-faint\b/);
    }
  });

  it("fades no date's ink with an opacity modifier", () => {
    expect(html).not.toMatch(/\btext-(faint|muted)\/\d+/);
  });

  it("still sets this month's days apart from the others", () => {
    expect([...html.matchAll(day(10))][0][1]).toMatch(/\btext-text\b/);
  });
});
