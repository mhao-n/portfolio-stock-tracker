import { createRequire } from "node:module";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, "public/ocr");
await mkdir(target, { recursive: true });
const runtime = dirname(require.resolve("tesseract.js/package.json"));
const core = dirname(require.resolve("tesseract.js-core/package.json"));
const language = dirname(
  require.resolve("@tesseract.js-data/eng/package.json"),
);
await copyFile(
  join(runtime, "dist/worker.min.js"),
  join(target, "worker.min.js"),
);
// Serve every engine variant locally; Tesseract picks the supported WASM build.
for (const file of await readdir(core)) {
  if (file.endsWith(".wasm") || file.endsWith(".wasm.js"))
    await copyFile(join(core, file), join(target, file));
}
await copyFile(
  join(language, "4.0.0_best_int/eng.traineddata.gz"),
  join(target, "eng.traineddata.gz"),
);
await copyFile(
  join(runtime, "dist/worker.min.js.LICENSE.txt"),
  join(target, "worker.min.js.LICENSE.txt"),
);
await copyFile(
  join(runtime, "LICENSE.md"),
  join(target, "TESSERACT-LICENSE.md"),
);
await copyFile(join(core, "LICENSE"), join(target, "CORE-LICENSE"));
console.log("Local screenshot recognition assets ready.");
