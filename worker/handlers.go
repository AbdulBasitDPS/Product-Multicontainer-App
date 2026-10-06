package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/jackc/pgx/v5"
)

const upsertSQL = `
INSERT INTO products(name, sku, price, stock, category) VALUES($1,$2,$3,$4,$5)
ON CONFLICT (sku) DO UPDATE SET
  name = EXCLUDED.name, price = EXCLUDED.price, stock = EXCLUDED.stock,
  category = EXCLUDED.category, updated_at = now()
RETURNING id`

// importCSV: split rows into chunks, process chunks concurrently (bounded), batch-upsert each.
func (w *Worker) importCSV(ctx context.Context, j Job) error {
	f, err := os.Open(j.File)
	if err != nil {
		return err
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1 // tolerate ragged rows; we validate ourselves
	records, err := r.ReadAll()
	if err != nil {
		w.failImport(ctx, j.JobID, "invalid CSV: "+err.Error())
		return nil // permanent error, no retry
	}
	if len(records) == 0 {
		w.failImport(ctx, j.JobID, "empty file")
		return nil
	}

	idx := map[string]int{}
	for i, h := range records[0] {
		idx[strings.ToLower(strings.TrimSpace(h))] = i
	}
	for _, col := range []string{"name", "sku", "price", "stock"} {
		if _, ok := idx[col]; !ok {
			w.failImport(ctx, j.JobID, "missing required column: "+col)
			return nil
		}
	}
	rows := records[1:]
	total := len(rows)

	if _, err := w.db.Exec(ctx,
		`UPDATE import_jobs SET status='processing', total_rows=$2, processed_rows=0, failed_rows=0, error=NULL WHERE id=$1`,
		j.JobID, total); err != nil {
		return err
	}

	var processed, failed int64
	sem := make(chan struct{}, w.chunkWorkers) // bounds concurrent chunks
	var wg sync.WaitGroup
	for start := 0; start < total; start += w.chunkSize {
		end := min(start+w.chunkSize, total)
		sem <- struct{}{}
		wg.Add(1)
		go func(chunk [][]string) {
			defer wg.Done()
			defer func() { <-sem }()
			ok, bad := w.upsertChunk(ctx, chunk, idx)
			p := atomic.AddInt64(&processed, int64(ok))
			fl := atomic.AddInt64(&failed, int64(bad))
			w.saveProgress(ctx, j.JobID, "processing", total, p, fl)
		}(rows[start:end])
	}
	wg.Wait()

	w.saveProgress(ctx, j.JobID, "completed", total, atomic.LoadInt64(&processed), atomic.LoadInt64(&failed))
	w.rdb.Incr(ctx, "products:ver") // invalidate cached product lists
	return nil
}

type productRow struct {
	name, sku, category string
	price               float64
	stock               int
}

func (w *Worker) upsertChunk(ctx context.Context, chunk [][]string, idx map[string]int) (ok, bad int) {
	get := func(rec []string, col string) string {
		i, found := idx[col]
		if !found || i >= len(rec) {
			return ""
		}
		return strings.TrimSpace(rec[i])
	}

	valid := make([]productRow, 0, len(chunk))
	for _, rec := range chunk {
		price, e1 := strconv.ParseFloat(get(rec, "price"), 64)
		stock, e2 := strconv.Atoi(get(rec, "stock"))
		p := productRow{name: get(rec, "name"), sku: get(rec, "sku"), category: get(rec, "category"), price: price, stock: stock}
		if p.name == "" || p.sku == "" || e1 != nil || e2 != nil || price < 0 || stock < 0 {
			bad++
			continue
		}
		valid = append(valid, p)
	}
	if len(valid) == 0 {
		return 0, bad
	}

	batch := &pgx.Batch{}
	for _, p := range valid {
		batch.Queue(upsertSQL, p.name, p.sku, p.price, p.stock, p.category)
	}
	br := w.db.SendBatch(ctx, batch)
	defer br.Close()

	keys := make([]string, 0, len(valid))
	for range valid {
		var id int64
		if err := br.QueryRow().Scan(&id); err != nil {
			log.Printf("chunk upsert failed: %v", err)
			return 0, bad + len(valid) // the batch runs in one implicit transaction
		}
		keys = append(keys, fmt.Sprintf("product:%d", id))
	}
	w.rdb.Del(ctx, keys...) // drop stale per-product cache entries
	return len(valid), bad
}

func (w *Worker) saveProgress(ctx context.Context, id, status string, total int, processed, failed int64) {
	_, err := w.db.Exec(ctx,
		`UPDATE import_jobs SET status=$2, total_rows=$3,
		 processed_rows=GREATEST(processed_rows,$4), failed_rows=GREATEST(failed_rows,$5) WHERE id=$1`,
		id, status, total, int(processed), int(failed))
	if err != nil {
		log.Printf("saveProgress: %v", err)
	}
	b, _ := json.Marshal(map[string]any{
		"type": "import_progress", "job_id": id, "status": status,
		"total": total, "processed": processed, "failed": failed,
	})
	w.rdb.Publish(ctx, "job_progress", b)
}

func (w *Worker) failImport(ctx context.Context, id, msg string) {
	if _, err := w.db.Exec(ctx, `UPDATE import_jobs SET status='failed', error=$2 WHERE id=$1`, id, msg); err != nil {
		log.Printf("failImport: %v", err)
	}
	b, _ := json.Marshal(map[string]any{"type": "import_progress", "job_id": id, "status": "failed", "error": msg})
	w.rdb.Publish(ctx, "job_progress", b)
}

func (w *Worker) lowStock(ctx context.Context, j Job) error {
	var name, sku string
	var stock int
	err := w.db.QueryRow(ctx, `SELECT name, sku, stock FROM products WHERE id = $1`, j.ProductID).Scan(&name, &sku, &stock)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // product deleted meanwhile
	}
	if err != nil {
		return err
	}
	if stock >= w.threshold {
		return nil // restocked meanwhile
	}
	b, _ := json.Marshal(map[string]any{
		"type": "low_stock", "product_id": j.ProductID, "name": name, "sku": sku, "stock": stock,
	})
	return w.rdb.Publish(ctx, "stock_alerts", b).Err()
}
