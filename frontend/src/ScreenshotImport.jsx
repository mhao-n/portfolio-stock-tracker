import React, { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Plus, RefreshCw, Trash2, X } from "lucide-react";
import {
  extractHoldings,
  parseAmount,
  reviewIssues,
} from "./screenshotParser.js";
import { recognizeScreenshot, validateScreenshot } from "./screenshotOcr.js";

import {
  combineScreenshotRows,
  validateScreenshotBatch,
} from "./screenshotBatch.js";

export default function ScreenshotImport({
  existingHoldings,
  onImport,
  onBusyChange,
}) {
  const [images, setImages] = useState([]);
  const [observations, setObservations] = useState([]);
  const [error, setError] = useState(""),
    [progress, setProgress] = useState(null);
  const [processing, setProcessing] = useState(false),
    [saving, setSaving] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const input = useRef(null),
    job = useRef(null),
    alive = useRef(true),
    counter = useRef(0);
  const imageStore = useRef([]),
    queue = useRef([]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queue.current = [];
      job.current?.abort();
      imageStore.current.forEach((image) => URL.revokeObjectURL(image.url));
    };
  }, []);
  function changeImages(transform) {
    imageStore.current = transform(imageStore.current);
    setImages(imageStore.current);
  }
  const rows = useMemo(
    () => combineScreenshotRows(observations),
    [observations],
  );
  const issues = useMemo(
    () => reviewIssues(rows, existingHoldings),
    [rows, existingHoldings],
  );
  const selected = rows.filter((row) => row.selected);
  const existing = new Map(existingHoldings.map((row) => [row.symbol, row]));
  const incomplete = images.some((image) => image.status !== "done");
  const invalid =
    issues.some((list) => list.length) || selected.length > 500 || incomplete;
  function update(index, patch) {
    const ids = rows[index].observationIds;
    setObservations((current) =>
      current.map((row) => (ids.includes(row.id) ? { ...row, ...patch } : row)),
    );
    setConfirmed(false);
  }
  function adopt(image, data, mapping = {}) {
    const parsed = extractHoldings(data, mapping);
    changeImages((current) =>
      current.map((item) =>
        item.id === image.id
          ? { ...item, result: data, mapping, parsed, status: "done" }
          : item,
      ),
    );
    setObservations((current) => [
      ...current.filter((row) => row.screenshotId !== image.id),
      ...parsed.rows.map((row) => ({
        ...row,
        id: ++counter.current,
        screenshotId: image.id,
        screenshotName: image.name,
        selected: true,
      })),
    ]);
    setConfirmed(false);
  }
  async function drain() {
    if (job.current || !alive.current) return;
    setProcessing(true);
    while (queue.current.length && alive.current) {
      const image = queue.current.shift();
      const controller = new AbortController();
      job.current = controller;
      changeImages((current) =>
        current.map((item) =>
          item.id === image.id ? { ...item, status: "reading" } : item,
        ),
      );
      setProgress({ name: image.name, progress: 0 });
      try {
        const data = await recognizeScreenshot(image.file, {
          signal: controller.signal,
          onProgress: (message) => {
            if (alive.current && !controller.signal.aborted)
              setProgress({ ...message, name: image.name });
          },
        });
        if (alive.current && !controller.signal.aborted) adopt(image, data);
      } catch (e) {
        if (alive.current && !controller.signal.aborted)
          changeImages((current) =>
            current.map((item) =>
              item.id === image.id ? { ...item, status: "error" } : item,
            ),
          );
      } finally {
        job.current = null;
      }
    }
    if (alive.current) {
      setProcessing(false);
      setProgress(null);
    }
  }
  function read(files) {
    if (saving || !files.length) return;
    try {
      files.forEach(validateScreenshot);
      validateScreenshotBatch(
        imageStore.current.map((image) => image.file),
        files,
      );
    } catch (e) {
      setError(e.message);
      return;
    }
    const added = files.map((file) => ({
      id: ++counter.current,
      file,
      url: URL.createObjectURL(file),
      name: file.name || "Pasted screenshot",
      status: "queued",
    }));
    changeImages((current) => [...current, ...added]);
    queue.current.push(...added);
    setError("");
    setConfirmed(false);
    void drain();
  }
  function cancel() {
    queue.current = [];
    job.current?.abort();
    changeImages((current) =>
      current.map((image) =>
        ["queued", "reading"].includes(image.status)
          ? { ...image, status: "canceled" }
          : image,
      ),
    );
    setConfirmed(false);
  }
  function removeImage(image) {
    URL.revokeObjectURL(image.url);
    changeImages((current) => current.filter((item) => item.id !== image.id));
    setObservations((current) =>
      current.filter((row) => row.screenshotId !== image.id),
    );
    setConfirmed(false);
  }
  function pasted(event) {
    const files = Array.from(event.clipboardData?.files || []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length) {
      event.preventDefault();
      read(files);
    }
  }
  async function save(event) {
    event.preventDefault();
    if (saving || processing || !selected.length || invalid || !confirmed)
      return;
    setSaving(true);
    onBusyChange(true);
    setError("");
    try {
      await onImport(
        selected.map((row) => ({
          symbol: row.symbol.trim().toUpperCase(),
          shares: Number(parseAmount(row.shares)),
          ...(row.avgCost !== "" && row.avgCost != null
            ? { avgCost: Number(parseAmount(row.avgCost)) }
            : {}),
        })),
      );
    } catch (e) {
      if (alive.current)
        setError(
          e.message ||
            "Could not import holdings. Your review is still available to retry.",
        );
    } finally {
      onBusyChange(false);
      if (alive.current) setSaving(false);
    }
  }
  return (
    <div className="screenshot-import" onPaste={pasted}>
      <p className="screenshot-intro">
        Paste or upload holdings screenshots from any brokerage, then review the
        combined extracted rows. Images are processed on this computer; no API
        key or paid service is needed.
      </p>
      <input
        ref={input}
        className="file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Upload portfolio screenshots"
        multiple
        disabled={saving}
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          read(files);
        }}
      />
      <div
        className="screenshot-drop"
        data-autofocus
        tabIndex={0}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          read(Array.from(event.dataTransfer.files || []));
        }}
      >
        <ImagePlus size={26} />
        <strong>Paste screenshots here with Ctrl+V</strong>
        <span>
          Choose or drop multiple images · PNG, JPEG, WebP · 10 MB each · 12
          images / 50 MB total
        </span>
        <button onClick={() => input.current?.click()} disabled={saving}>
          Choose screenshots
        </button>
      </div>
      {images.length > 0 && (
        <div className="screenshot-batch">
          <p className="screenshot-help">
            {images.length} / 12 screenshots · Matching positions are combined
            without adding shares. Conflicting rows stay separate; uncheck or
            remove the incorrect row. You can keep adding screenshots.
          </p>
          {images.map((image, index) => (
            <div className="screenshot-file" key={image.id}>
              <div className="screenshot-file-heading">
                <span>
                  Screenshot {index + 1}: {image.name} ·{" "}
                  {image.status === "done"
                    ? image.parsed.rows.length + " rows read"
                    : image.status}
                </span>
                <div>
                  {["error", "canceled"].includes(image.status) && (
                    <button
                      disabled={processing || saving}
                      onClick={() => {
                        changeImages((current) =>
                          current.map((item) =>
                            item.id === image.id
                              ? { ...item, status: "queued" }
                              : item,
                          ),
                        );
                        queue.current.push(image);
                        setConfirmed(false);
                        void drain();
                      }}
                    >
                      Retry screenshot {index + 1}
                    </button>
                  )}
                  <button
                    className="icon danger"
                    aria-label={`Remove screenshot ${index + 1}`}
                    disabled={processing || saving}
                    onClick={() => removeImage(image)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              {["error", "canceled"].includes(image.status) && (
                <p className="bad" role="status">
                  Retry or remove this screenshot before importing. Completed
                  screenshots are still available.
                </p>
              )}
              {image.status === "done" && !image.parsed.rows.length && (
                <p className="screenshot-help">
                  No holdings identified. Adjust the columns, add rows manually,
                  or remove this image.
                </p>
              )}
              <details className="screenshot-preview">
                <summary>View screenshot {index + 1}</summary>
                <img
                  src={image.url}
                  alt={`Portfolio screenshot ${index + 1}`}
                />
              </details>
              {image.parsed?.columns.length > 0 && (
                <details className="screenshot-mapping">
                  <summary>Adjust columns for screenshot {index + 1}</summary>
                  <p>
                    Choose the columns for each field. Average cost means
                    purchase cost per share. Changing a mapping replaces this
                    screenshot's extracted rows.
                  </p>
                  <div className="mapping-fields">
                    {[
                      ["symbol", "Ticker"],
                      ["shares", "Shares"],
                      ["avgCost", "Average cost"],
                      ["costBasis", "Total cost basis"],
                    ].map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <select
                          aria-label={`Screenshot ${index + 1} ${label} source column`}
                          value={image.parsed.mapping[key] ?? ""}
                          disabled={saving || processing}
                          onChange={(event) =>
                            adopt(image, image.result, {
                              ...image.parsed.mapping,
                              [key]: event.target.value,
                            })
                          }
                        >
                          <option value="">Not in screenshot</option>
                          {image.parsed.columns.map((column) => (
                            <option key={column.id} value={column.id}>
                              {column.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </details>
              )}
              {image.result?.text && (
                <details className="ocr-source">
                  <summary>Recognized text for screenshot {index + 1}</summary>
                  <pre>{image.result.text}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
      {processing && (
        <div className="ocr-progress" role="status">
          <span>
            {progress?.status?.includes("recogniz")
              ? "Reading screenshots"
              : progress?.status?.includes("load")
                ? "Loading local recognition resources"
                : "Preparing screenshot"}
            … {progress?.name}
          </span>
          <progress max={1} value={progress?.progress || 0} />
          <button onClick={cancel}>
            <X size={15} /> Cancel recognition
          </button>
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {incomplete && !processing && (
        <p className="bad" role="status">
          Retry or remove unfinished screenshots to enable import.
        </p>
      )}
      {selected.length > 500 && (
        <p className="bad" role="status">
          Select at most 500 holdings per import.
        </p>
      )}
      <form onSubmit={save}>
        <div className="section-heading">
          <h3>
            Review holdings <span className="count-badge">{rows.length}</span>
          </h3>
          <button
            type="button"
            disabled={saving || processing || rows.length >= 500}
            onClick={() => {
              setObservations((current) => [
                ...current,
                {
                  id: ++counter.current,
                  symbol: "",
                  shares: "",
                  avgCost: "",
                  selected: true,
                  notes: [],
                  source: "Manually added",
                  confidence: 100,
                },
              ]);
              setConfirmed(false);
            }}
          >
            <Plus size={15} /> Add row
          </button>
        </div>
        {rows.length > 0 && (
          <>
            <p className="screenshot-help">
              All costs below use USD. Matched tickers update their existing
              positions. Other holdings and cash stay as they are. A blank
              average cost keeps an existing holding's cost; new holdings need a
              cost.
            </p>
            <div className="screenshot-rows">
              {rows.map((row, index) => {
                const match = existing.get(row.symbol.trim().toUpperCase());
                return (
                  <fieldset
                    className="screenshot-row"
                    key={row.id}
                    disabled={saving || processing}
                  >
                    <legend className="sr-only">Holding {index + 1}</legend>
                    <div className="screenshot-row-head">
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(event) =>
                            update(index, { selected: event.target.checked })
                          }
                        />
                        <span>
                          Row {index + 1} ·{" "}
                          {match ? "Update existing" : "New holding"}
                        </span>
                      </label>
                      <button
                        type="button"
                        className="icon danger"
                        aria-label={`Remove import row ${index + 1}`}
                        onClick={() => {
                          setObservations((current) =>
                            current.filter(
                              (item) => !row.observationIds.includes(item.id),
                            ),
                          );
                          setConfirmed(false);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="screenshot-row-fields">
                      <label>
                        Ticker
                        <input
                          aria-label={`Row ${index + 1} ticker`}
                          maxLength={15}
                          value={row.symbol}
                          onChange={(event) =>
                            update(index, {
                              symbol: event.target.value.toUpperCase(),
                            })
                          }
                        />
                      </label>
                      <label>
                        Shares
                        <input
                          aria-label={`Row ${index + 1} shares`}
                          inputMode="decimal"
                          value={row.shares}
                          onChange={(event) =>
                            update(index, { shares: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Average cost ($)
                        <input
                          aria-label={`Row ${index + 1} average cost`}
                          inputMode="decimal"
                          value={row.avgCost}
                          placeholder={
                            match
                              ? `Keep ${Number(match.avgCost).toFixed(2)}`
                              : "Required"
                          }
                          onChange={(event) =>
                            update(index, { avgCost: event.target.value })
                          }
                        />
                      </label>
                    </div>
                    <p className="screenshot-help">
                      {row.sources.length > 1
                        ? `Combined from ${row.sources.length} screenshots`
                        : row.sources[0].name}
                    </p>
                    {row.confidence < 65 && (
                      <p className="ocr-caution">
                        Some text was unclear. Check this row against the
                        screenshot.
                      </p>
                    )}
                    {row.notes?.map((note) => (
                      <p key={note} className="screenshot-help">
                        {note}
                      </p>
                    ))}
                    {issues[index]?.length > 0 && (
                      <p className="bad" role="status">
                        {issues[index].join(" ")}
                      </p>
                    )}
                    <details className="ocr-source">
                      <summary>Recognized source text</summary>
                      <p>
                        {row.sources
                          .map((source) => source.name + ": " + source.text)
                          .join("\n\n")}
                      </p>
                    </details>
                  </fieldset>
                );
              })}
            </div>
            <label className="screenshot-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={saving || processing}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                I checked the tickers, share quantities, and average costs
                above.
              </span>
            </label>
          </>
        )}
        <footer className="screenshot-footer">
          <span>
            {selected.length} {selected.length === 1 ? "holding" : "holdings"}{" "}
            selected
          </span>
          <button
            className="refresh"
            disabled={
              !confirmed || !selected.length || invalid || processing || saving
            }
          >
            {saving ? (
              <>
                <RefreshCw size={16} /> Importing…
              </>
            ) : (
              `Import ${selected.length} ${selected.length === 1 ? "holding" : "holdings"}`
            )}
          </button>
        </footer>
      </form>
    </div>
  );
}
