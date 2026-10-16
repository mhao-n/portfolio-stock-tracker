import React, { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Plus, RefreshCw, Trash2, X } from "lucide-react";
import {
  extractHoldings,
  parseAmount,
  reviewIssues,
} from "./screenshotParser.js";
import { recognizeScreenshot, validateScreenshot } from "./screenshotOcr.js";

export default function ScreenshotImport({
  existingHoldings,
  onImport,
  onBusyChange,
}) {
  const [image, setImage] = useState(null),
    [result, setResult] = useState(null),
    [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({}),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(null);
  const [processing, setProcessing] = useState(false),
    [saving, setSaving] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const input = useRef(null),
    job = useRef(null),
    alive = useRef(true),
    counter = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      job.current?.abort();
    };
  }, []);
  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url);
    },
    [image],
  );
  const issues = useMemo(
    () => reviewIssues(rows, existingHoldings),
    [rows, existingHoldings],
  );
  const selected = rows.filter((row) => row.selected);
  const existing = new Map(existingHoldings.map((row) => [row.symbol, row]));
  const parsed = useMemo(
    () => (result ? extractHoldings(result, mapping) : null),
    [result, mapping],
  );
  const invalid = issues.some((list) => list.length);
  function update(index, patch) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
    setConfirmed(false);
  }
  function adopt(data, nextMapping = {}) {
    const next = extractHoldings(data, nextMapping);
    setMapping(nextMapping);
    setRows(
      next.rows
        .slice(0, 500)
        .map((row) => ({ ...row, id: ++counter.current, selected: true })),
    );
    setConfirmed(false);
    if (next.rows.length > 500)
      setError(
        "Only the first 500 rows are shown. Import a smaller screenshot for the remaining holdings.",
      );
  }
  async function read(file) {
    if (saving || processing) return;
    try {
      validateScreenshot(file);
    } catch (e) {
      setError(e.message);
      return;
    }
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    setImage({
      url: URL.createObjectURL(file),
      name: file.name || "Pasted screenshot",
    });
    setResult(null);
    setRows([]);
    setError("");
    setConfirmed(false);
    setProcessing(true);
    setProgress({ status: "Preparing screenshot", progress: 0 });
    try {
      const data = await recognizeScreenshot(file, {
        signal: controller.signal,
        onProgress: (message) => {
          if (alive.current && !controller.signal.aborted) setProgress(message);
        },
      });
      if (alive.current && !controller.signal.aborted) {
        setResult(data);
        adopt(data);
      }
    } catch (e) {
      if (alive.current && !controller.signal.aborted)
        setError(
          "Could not read this screenshot. Try a clearer image or add the rows manually.",
        );
    } finally {
      if (alive.current && job.current === controller) {
        setProcessing(false);
        setProgress(null);
      }
    }
  }
  function cancel() {
    job.current?.abort();
    setProcessing(false);
    setProgress(null);
    setError(
      "Recognition canceled. Choose another image or enter holdings manually.",
    );
  }
  function pasted(event) {
    const file = Array.from(event.clipboardData?.files || []).find((file) =>
      file.type.startsWith("image/"),
    );
    if (file) {
      event.preventDefault();
      void read(file);
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
        Paste or upload a holdings screenshot from a brokerage, then review the
        extracted rows. Images are processed on this computer; no API key or
        paid service is needed.
      </p>
      <input
        ref={input}
        className="file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Upload portfolio screenshot"
        disabled={processing || saving}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void read(file);
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
          const file = event.dataTransfer.files?.[0];
          if (file) void read(file);
        }}
      >
        <ImagePlus size={26} />
        <strong>Paste a screenshot here with Ctrl+V</strong>
        <span>Or drop an image · PNG, JPEG, WebP · up to 10 MB</span>
        <button
          onClick={() => input.current?.click()}
          disabled={processing || saving}
        >
          Choose screenshot
        </button>
      </div>
      {image && (
        <details className="screenshot-preview">
          <summary>View screenshot: {image.name}</summary>
          <img
            src={image.url}
            alt="Uploaded portfolio screenshot for comparison"
          />
        </details>
      )}
      {processing && (
        <div className="ocr-progress" role="status">
          <span>
            {progress?.status?.includes("recogniz")
              ? "Reading screenshot"
              : progress?.status?.includes("load")
                ? "Loading local recognition resources"
                : "Preparing screenshot"}
            …
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
      {result && !rows.length && (
        <p role="status">
          No holdings could be identified. Try a crop that includes tickers and
          share quantities, or add rows below.
        </p>
      )}
      {parsed?.columns.length > 0 && (
        <details className="screenshot-mapping">
          <summary>Adjust detected column mapping</summary>
          <p>
            Choose the screenshot columns for each field. Only select average
            cost if that column is the purchase cost per share.
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
                  aria-label={`${label} source column`}
                  value={parsed.mapping[key] ?? ""}
                  disabled={saving || processing}
                  onChange={(event) =>
                    adopt(result, {
                      ...parsed.mapping,
                      [key]: event.target.value,
                    })
                  }
                >
                  <option value="">Not in screenshot</option>
                  {parsed.columns.map((column) => (
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
      <form onSubmit={save}>
        <div className="section-heading">
          <h3>
            Review holdings <span className="count-badge">{rows.length}</span>
          </h3>
          <button
            type="button"
            disabled={saving || processing || rows.length >= 500}
            onClick={() => {
              setRows((current) => [
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
                          setRows((current) =>
                            current.filter((_, i) => i !== index),
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
                      <p>{row.source}</p>
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
      {result?.text && (
        <details className="ocr-source">
          <summary>All recognized text</summary>
          <pre>{result.text}</pre>
        </details>
      )}
    </div>
  );
}
