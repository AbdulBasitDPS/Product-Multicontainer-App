package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type App struct {
	cfg Config
	db  *pgxpool.Pool
	rdb *redis.Client
	hub *Hub
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

func waitRedis(ctx context.Context, rdb *redis.Client) {
	for i := 0; i < 30; i++ {
		err := rdb.Ping(ctx).Err()
		if err == nil {
			return
		}
		log.Printf("waiting for dragonfly: %v", err)
		time.Sleep(2 * time.Second)
	}
	log.Fatal("dragonfly unavailable")
}

func main() {
	cfg := loadConfig()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := os.MkdirAll(cfg.UploadDir, 0o755); err != nil {
		log.Fatal(err)
	}
	db := connectPG(ctx, cfg.DatabaseURL)
	defer db.Close()
	rdb := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr})
	waitRedis(ctx, rdb)

	app := &App{cfg: cfg, db: db, rdb: rdb, hub: newHub()}
	go app.hub.run()
	go app.subscribeEvents(ctx)

	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer, cors(cfg.CORSOrigin))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	r.Post("/auth/register", app.register)
	r.Post("/auth/login", app.login)
	r.Get("/ws", app.serveWS)

	r.Get("/products", app.listProducts)
	r.Get("/products/{id}", app.getProduct)
	r.Group(func(r chi.Router) {
		r.Use(app.requireAuth)
		r.Post("/products", app.createProduct)
		r.Put("/products/{id}", app.updateProduct)
		r.Delete("/products/{id}", app.deleteProduct)
		r.Post("/products/import", app.importProducts)
		r.Get("/imports/{id}", app.getImport)
	})

	srv := &http.Server{Addr: ":" + cfg.Port, Handler: r}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()
	log.Printf("backend listening on :%s", cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
