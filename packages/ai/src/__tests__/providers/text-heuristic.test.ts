import { describe, it, expect } from "vitest";
import {
  HeuristicTextProvider,
  extractKeywordsHeuristic,
} from "../../providers/text/heuristic.js";

describe("extractKeywordsHeuristic", () => {
  it("returns empty for empty input", () => {
    expect(extractKeywordsHeuristic("")).toEqual([]);
  });

  it("drops stopwords and short tokens", () => {
    const out = extractKeywordsHeuristic("the cat sat on a mat by the door", 5);
    expect(out).toContain("cat");
    expect(out).toContain("mat");
    expect(out).toContain("door");
    expect(out).not.toContain("the");
    expect(out).not.toContain("on");
  });

  it("ranks by frequency", () => {
    const out = extractKeywordsHeuristic("alpha beta alpha gamma alpha beta delta", 3);
    expect(out[0]).toBe("alpha");
    expect(out.slice(1).sort()).toEqual(["beta", "gamma"]);
  });

  it("respects max", () => {
    const out = extractKeywordsHeuristic(
      "alpha bravo charlie delta echo foxtrot golf hotel",
      3
    );
    expect(out).toHaveLength(3);
  });
});

describe("HeuristicTextProvider", () => {
  it("generateTags is a thin wrapper around the heuristic", async () => {
    const p = new HeuristicTextProvider();
    const tags = await p.generateTags("design research design ideas");
    expect(tags).toContain("design");
  });

  it("summarize returns empty string by design", async () => {
    const p = new HeuristicTextProvider();
    expect(await p.summarize("anything")).toBe("");
  });

  it("info() returns deterministic-keyword-v1", () => {
    const p = new HeuristicTextProvider();
    expect(p.info()).toEqual({ name: "heuristic", model: "deterministic-keyword-v1" });
  });
});
