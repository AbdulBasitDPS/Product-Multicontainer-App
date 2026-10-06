package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const maxAttempts = 3

// Job mirrors the backend's Job message.
type Job struct {
	Type      string `json:"type"` // import_csv | low_stock
	JobID     string `json:"job_id,omitempty"`
	File      string `json:"file,omitempty"`
	ProductID int64  `json:"product_id,omitempty"`
	Attempt   int    `json:"attempt"`
}

type Worker struct {
	db           *pgxpool.Pool
	rdb          *redis.Client
	chunkSize    int // rows per chunk in a CSV import
	chunkWorkers int // concurrent chunks per import
	threshold    int // low-stock threshold
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func envInt(k string, d int) int {
	if v, err := strconv.Atoi(os.Getenv(k)); err == nil && v > 0 {
		return v
	}
	return d
}

func connectPG(ctx context.Context, url string) *pgxpool.Pool {
	for i := 0; i < 30; i++ {
		pool, err := pgxpool.New(ctx, url)
		if err == nil {
			if err = pool.Ping(ctx); err == nil {
				return pool
			}
			pool.Close()
		}
		log.Printf("waiting for postgres: %v", err)
		time.Sleep(2 * time.Second)
	}
	log.Fatal("postgres unavailable")
	return nil
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db := connectPG(ctx, env("DATABASE_URL", "postgres://shop:shop_secret@localhost:5432/shop?sslmode=disable"))
	defer db.Close()
	rdb := redis.NewClient(&redis.Options{Addr: env("REDIS_ADDR", "localhost:6379")})
	for i := 0; i < 30 && rdb.Ping(ctx).Err() != nil; i++ {
		log.Println("waiting for dragonfly...")
		time.Sleep(2 * time.Second)
	}

	numWorkers := envInt("WORKER_COUNT", 5)
	w := &Worker{
		db:           db,
		rdb:          rdb,
		chunkSize:    envInt("CHUNK_SIZE", 100),
		chunkWorkers: envInt("CHUNK_WORKERS", 4),
		threshold:    envInt("LOW_STOCK_THRESHOLD", 5),
	}

	// ---- worker pool: N goroutines consuming a buffered channel ----
	jobs := make(chan Job, numWorkers*2)
	var wg sync.WaitGroup
	for i := 1; i <= numWorkers; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for j := range jobs {
				w.process(id, j)
			}
		}(i)
	}
	log.Printf("worker started: %d goroutines, chunk size %d x %d parallel chunks",
		numWorkers, w.chunkSize, w.chunkWorkers)

	// ---- dispatcher: Dragonfly list -> channel (blocks when the pool is busy = backpressure) ----
	for ctx.Err() == nil {
		res, err := rdb.BRPop(ctx, 2*time.Second, "jobs").Result()
		if err != nil {
			if err != redis.Nil && ctx.Err() == nil {
				log.Printf("queue error: %v", err)
				time.Sleep(time.Second)
			}
			continue
		}
		var j Job
		if err := json.Unmarshal([]byte(res[1]), &j); err != nil {
			log.Printf("bad job payload: %v", err)
			continue
		}
		jobs <- j
	}

	// ---- graceful shutdown: stop pulling, let in-flight jobs finish ----
	log.Println("shutdown signal received, draining in-flight jobs...")
	close(jobs)
	wg.Wait()
	log.Println("worker stopped cleanly")
}

func (w *Worker) process(id int, j Job) {
	start := time.Now()
	// in-flight jobs use their own context so they can finish after SIGTERM
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	log.Printf("[goroutine %d] start %s (attempt %d)", id, j.Type, j.Attempt+1)

	var err error
	switch j.Type {
	case "import_csv":
		err = w.importCSV(ctx, j)
	case "low_stock":
		err = w.lowStock(ctx, j)
	default:
		log.Printf("[goroutine %d] unknown job type %q", id, j.Type)
		return
	}

	if err != nil {
		j.Attempt++
		if j.Attempt < maxAttempts {
			delay := time.Duration(j.Attempt) * 2 * time.Second
			log.Printf("[goroutine %d] %s failed: %v - retry in %s", id, j.Type, err, delay)
			time.AfterFunc(delay, func() {
				if b, e := json.Marshal(j); e == nil {
					w.rdb.LPush(context.Background(), "jobs", b)
				}
			})
			return
		}
		log.Printf("[goroutine %d] %s failed permanently: %v", id, j.Type, err)
		if j.Type == "import_csv" {
			w.failImport(ctx, j.JobID, err.Error())
		}
		return
	}
	log.Printf("[goroutine %d] done %s in %s", id, j.Type, time.Since(start).Round(time.Millisecond))
}
