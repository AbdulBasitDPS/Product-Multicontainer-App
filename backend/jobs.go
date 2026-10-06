package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// Job is the message pushed to the Dragonfly list "jobs" and consumed by the worker.
type Job struct {
	Type      string `json:"type"` // import_csv | low_stock
	JobID     string `json:"job_id,omitempty"`
	File      string `json:"file,omitempty"`
	ProductID int64  `json:"product_id,omitempty"`
	Attempt   int    `json:"attempt"`
}

func (a *App) enqueue(ctx context.Context, j Job) error {
	b, err := json.Marshal(j)
	if err != nil {
		return err
	}
	return a.rdb.LPush(ctx, "jobs", b).Err()
}

type ImportJob struct {
	ID        string    `json:"id"`
	Status    string    `json:"status"`
	Total     int       `json:"total_rows"`
	Processed int       `json:"processed_rows"`
	Failed    int       `json:"failed_rows"`
	Error     string    `json:"error"`
	CreatedAt time.Time `json:"created_at"`
}

func (a *App) importProducts(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 20<<20) // 20 MB
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, 400, "multipart field 'file' (CSV) is required")
		return
	}
	defer file.Close()

	id := newID()
	path := filepath.Join(a.cfg.UploadDir, id+".csv")
	out, err := os.Create(path)
	if err != nil {
		writeErr(w, 500, "could not save upload")
		return
	}
	_, err = io.Copy(out, file)
	out.Close()
	if err != nil {
		writeErr(w, 500, "could not save upload")
		return
	}

	if _, err := a.db.Exec(r.Context(),
		`INSERT INTO import_jobs(id, status, file_path) VALUES($1, 'queued', $2)`, id, path); err != nil {
		writeErr(w, 500, "database error")
		return
	}
	if err := a.enqueue(r.Context(), Job{Type: "import_csv", JobID: id, File: path}); err != nil {
		writeErr(w, 503, "queue unavailable")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job_id": id, "status": "queued"})
}

func (a *App) getImport(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var j ImportJob
	err := a.db.QueryRow(r.Context(),
		`SELECT id, status, total_rows, processed_rows, failed_rows, COALESCE(error,''), created_at
		 FROM import_jobs WHERE id = $1`, id).
		Scan(&j.ID, &j.Status, &j.Total, &j.Processed, &j.Failed, &j.Error, &j.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, 404, "import job not found")
		return
	}
	if err != nil {
		writeErr(w, 500, "database error")
		return
	}
	writeJSON(w, 200, j)
}
