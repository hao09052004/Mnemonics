import { describe, it, expect } from "vitest";
import { ClipLocalProvider } from "../../providers/vision/clip.js";

describe("ClipLocalProvider (M0 stub)", () => {
  it("info() reports not-loaded until M7", () => {
    const p = new ClipLocalProvider();
    expect(p.info().loaded).toBe(false);
    expect(p.info().dimensions).toBe(512);
    expect(p.info().name).toBe("clip-local");
  });

  it("embed() throws until M7 wires the real model", async () => {
    const p = new ClipLocalProvider();
    await p.warmup(); // no-op for now
    await expect(
      p.embed({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" })
    ).rejects.toThrowError(/not loaded/);
  });
});
