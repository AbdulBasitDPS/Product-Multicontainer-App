"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileSpreadsheet,
  X,
  RefreshCw,
  CheckCircle2,
  Download,
} from "lucide-react";
import { api, errorMessage, type ImportJob, type LiveEvent } from "@/lib/api";
import { useAuth } from "./auth-provider";

type TrackedJob = ImportJob & { filename: string };
const active = (job: TrackedJob) =>
  job.status === "queued" || job.status === "processing";

export function Imports() {
  const { session, ready } = useAuth();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const jobsRef = useRef(jobs);
  const storageKey = session ? `precision-imports-${session.user.id}` : "";
  useEffect(() => {
    if (ready && !session) router.replace("/login");
  }, [ready, session, router]);
  useEffect(() => {
    if (!storageKey) return;
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(stored))
        setJobs(
          stored
            .filter(
              (j: TrackedJob) =>
                typeof j.id === "string" &&
                typeof j.filename === "string" &&
                ["queued", "processing", "completed", "failed"].includes(
                  j.status,
                ),
            )
            .slice(0, 20),
        );
    } catch {
      /* Import tracking is optional when browser storage is disabled. */
    }
    setLoaded(true);
  }, [storageKey]);
  useEffect(() => {
    jobsRef.current = jobs;
    if (loaded && storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(jobs));
      } catch {
        /* Continue with in-memory tracking. */
      }
    }
  }, [jobs, loaded, storageKey]);
  useEffect(() => {
    if (!session || !loaded) return;
    const controller = new AbortController();
    let fetching = false;
    let first = true;
    const refresh = async () => {
      if (fetching || controller.signal.aborted) return;
      const targets = jobsRef.current.filter((job) => first || active(job));
      first = false;
      if (!targets.length) return;
      fetching = true;
      const results = await Promise.allSettled(
        targets.map((job) =>
          api.importStatus(job.id, session.token, controller.signal),
        ),
      );
      if (controller.signal.aborted) return;
      const statuses = new Map<string, ImportJob>();
      let message = "";
      results.forEach((result) => {
        if (result.status === "fulfilled")
          statuses.set(result.value.id, result.value);
        else message = errorMessage(result.reason);
      });
      setJobs((current) =>
        current.map((job) =>
          statuses.has(job.id) ? { ...job, ...statuses.get(job.id)! } : job,
        ),
      );
      setPollError(message);
      fetching = false;
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    const liveUpdate = (event: Event) => {
      const live = (event as CustomEvent<LiveEvent>).detail;
      if (
        live.channel === "job_progress" &&
        jobsRef.current.some((job) => job.id === live.data.job_id)
      )
        void refresh();
    };
    window.addEventListener("inventory-event", liveUpdate);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("inventory-event", liveUpdate);
    };
  }, [session, loaded, refreshKey]);

  function choose(selected?: File) {
    setError("");
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".csv")) {
      setError("Choose a CSV file.");
      return;
    }
    if (selected.size === 0) {
      setError("The file is empty.");
      return;
    }
    if (selected.size > 20 * 1024 * 1024 - 4096) {
      setError("Choose a file smaller than 20 MB.");
      return;
    }
    setFile(selected);
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !session) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.upload(file, session.token);
      const job: TrackedJob = {
        id: result.job_id,
        filename: file.name,
        status: result.status,
        total_rows: 0,
        processed_rows: 0,
        failed_rows: 0,
        error: "",
        created_at: new Date().toISOString(),
      };
      setJobs((current) => [job, ...current].slice(0, 20));
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (!ready || !session)
    return (
      <p className="muted" role="status">
        Loading...
      </p>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>CSV imports</h1>
          <p className="muted">Add or update products in bulk.</p>
        </div>
        <a href="/products-template.csv" download className="button secondary">
          <Download size={16} />
          Sample CSV
        </a>
      </div>
      <section className="card import-schema" aria-label="CSV columns">
        <div>
          <span className="eyebrow">Required columns</span>
          <div className="column-chips">
            {["name", "sku", "price", "stock"].map((column) => (
              <code key={column}>{column}</code>
            ))}
          </div>
        </div>
        <div>
          <span className="eyebrow">Optional</span>
          <div className="column-chips">
            <code>category</code>
          </div>
        </div>
        <p className="muted">
          Existing SKUs are updated.
          <br />
          New SKUs create products.
        </p>
      </section>
      <form onSubmit={upload} className="import-upload-layout">
        <label
          className={`card dropzone ${dragging ? "dragging" : ""} ${busy ? "disabled" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!busy) choose(event.dataTransfer.files[0]);
          }}
        >
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(event) => choose(event.target.files?.[0])}
            aria-label="Choose CSV file"
          />
          <span className="upload-icon">
            <Upload size={26} />
          </span>
          <strong>Upload a CSV file</strong>
          <span className="muted">
            Drag it here or <span className="browse-inline">browse files</span>
          </span>
          <span className="upload-limit">CSV only · under 20 MB</span>
        </label>
        <section className="card staged-file" aria-label="Selected file">
          <div className="staged-heading">
            <h2>Selected file</h2>
            {file && <span className="badge processing">Ready to import</span>}
          </div>
          {file ? (
            <div className="selected-file">
              <FileSpreadsheet size={22} />
              <div>
                <strong>{file.name}</strong>
                <span className="muted small">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Remove selected file"
                disabled={busy}
                onClick={() => {
                  setFile(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
              >
                <X size={17} />
              </button>
            </div>
          ) : (
            <div className="no-file">
              <FileSpreadsheet size={24} />
              <p>Choose a file to import.</p>
            </div>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={!file || busy}>
            <Upload size={16} />
            {busy ? "Uploading..." : "Import products"}
          </button>
        </section>
      </form>
      <div className="section-heading">
        <h2>Recent imports</h2>
        <span className="muted">Saved in this browser</span>
      </div>
      {pollError && (
        <div className="notice error-notice" role="alert">
          <span>{pollError}</span>
          <button
            className="button secondary"
            onClick={() => setRefreshKey((v) => v + 1)}
          >
            Retry
          </button>
        </div>
      )}
      {!jobs.length ? (
        <section className="card empty-state">
          <FileSpreadsheet size={28} className="muted" />
          <p className="muted">Your imports will appear here.</p>
        </section>
      ) : (
        <div className="import-list">
          {jobs.map((job) => {
            const completed = job.processed_rows + job.failed_rows;
            const progress =
              job.total_rows > 0
                ? Math.min(100, Math.round((completed / job.total_rows) * 100))
                : job.status === "completed"
                  ? 100
                  : 0;
            const style =
              job.status === "failed"
                ? "danger"
                : job.status === "completed"
                  ? job.failed_rows > 0
                    ? "warning"
                    : "success"
                  : "processing";
            return (
              <article className="card import-card" key={job.id}>
                <div className="import-header">
                  <span className="file-icon">
                    <FileSpreadsheet size={21} />
                  </span>
                  <div className="import-name">
                    <h3>{job.filename}</h3>
                    <span className="muted small">
                      {new Date(job.created_at).toLocaleString()}
                    </span>
                  </div>
                  <span className={`badge ${style}`}>
                    {job.status === "completed" && job.failed_rows > 0
                      ? "Completed with errors"
                      : job.status}
                  </span>
                </div>
                <div className="progress-row">
                  <progress
                    value={progress}
                    max={100}
                    aria-label={`Progress for ${job.filename}`}
                  />
                  <span className="mono small">{progress}%</span>
                </div>
                <div className="import-counts">
                  <span>
                    <strong>{job.processed_rows}</strong> imported
                  </span>
                  <span className={job.failed_rows ? "failed-count" : ""}>
                    <strong>{job.failed_rows}</strong> failed
                  </span>
                  <span className="muted">{job.total_rows} total rows</span>
                  {active(job) ? (
                    <RefreshCw
                      size={14}
                      className="spin progress-icon"
                      aria-label="Processing"
                    />
                  ) : (
                    job.status === "completed" && (
                      <CheckCircle2
                        size={16}
                        className="completed-icon"
                        aria-label="Completed"
                      />
                    )
                  )}
                </div>
                {job.error && (
                  <p className="error-message" role="alert">
                    {job.error}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
