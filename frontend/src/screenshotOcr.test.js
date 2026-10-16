import test from "node:test";
import assert from "node:assert/strict";
import { validateScreenshot } from "./screenshotOcr.js";
test("accepts only supported, nonempty screenshot files within the size limit", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp"])
    assert.doesNotThrow(() => validateScreenshot({ type, size: 1024 }));
  for (const file of [
    { type: "image/svg+xml", size: 100 },
    { type: "application/pdf", size: 100 },
    { type: "image/png", size: 0 },
    { type: "image/png", size: 11 * 1024 * 1024 },
  ])
    assert.throws(() => validateScreenshot(file));
});
