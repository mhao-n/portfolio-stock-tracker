export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function validateScreenshot(file) {
  if (!file || !IMAGE_TYPES.includes(file.type))
    throw new Error("Choose a PNG, JPEG, or WebP screenshot.");
  if (!file.size || file.size > MAX_IMAGE_BYTES)
    throw new Error("Choose a screenshot smaller than 10 MB.");
}

function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(
        new DOMException("Screenshot recognition canceled.", "AbortError"),
      );
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

async function imageCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(
          new Error("This image could not be opened. Try another screenshot."),
        );
      img.src = url;
    });
    if (image.naturalWidth * image.naturalHeight > 20000000)
      throw new Error(
        "This image is too large. Crop it to the holdings section.",
      );
    const scale = Math.min(
      2,
      4000 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw new Error("Your browser could not prepare this screenshot.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Normalize dark brokerage screenshots to dark text on a light background.
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0,
      count = 0;
    for (let i = 0; i < pixels.data.length; i += 160) {
      sum += (pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2]) / 3;
      count++;
    }
    const invert = sum / count < 128;
    for (let i = 0; i < pixels.data.length; i += 4) {
      let gray =
        0.299 * pixels.data[i] +
        0.587 * pixels.data[i + 1] +
        0.114 * pixels.data[i + 2];
      if (invert) gray = 255 - gray;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Images stay in this browser. Runtime, model, and WASM are served by this app.
export async function recognizeScreenshot(
  file,
  { signal, onProgress = () => {} } = {},
) {
  validateScreenshot(file);
  const abortError = () =>
    new DOMException("Screenshot recognition canceled.", "AbortError");
  if (signal?.aborted) throw abortError();
  const canvas = await imageCanvas(file);
  const { createWorker } = await import("tesseract.js");
  if (signal?.aborted) throw abortError();
  let worker;
  const terminate = () => {
    if (worker) void worker.terminate().catch(() => {});
  };
  signal?.addEventListener("abort", terminate, { once: true });
  try {
    const base = new URL(
      import.meta.env.BASE_URL + "ocr/",
      window.location.href,
    ).href;
    onProgress({ status: "Preparing local text recognition", progress: 0 });
    const initializing = createWorker("eng", 1, {
      workerPath: base + "worker.min.js",
      corePath: base,
      langPath: base,
      workerBlobURL: false,
      cacheMethod: "none",
      logger: (message) => {
        if (!signal?.aborted) onProgress(message);
      },
    });
    initializing.then(
      (value) => {
        if (signal?.aborted) void value.terminate().catch(() => {});
      },
      () => {},
    );
    worker = await abortable(initializing, signal);
    if (signal?.aborted) throw abortError();
    await worker.setParameters({
      preserve_interword_spaces: "1",
      user_defined_dpi: "150",
    });
    const result = await abortable(
      worker.recognize(canvas, {}, { text: true, blocks: true }),
      signal,
    );
    if (signal?.aborted) throw abortError();
    return result.data;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", terminate);
    if (worker) await worker.terminate().catch(() => {});
    canvas.width = canvas.height = 0;
  }
}
