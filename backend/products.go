package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	productCols = "id, name, sku, price, stock, category, created_at, updated_at"
	productTTL  = 5 * time.Minute
	listTTL     = 60 * time.Second
)

type Product struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	SKU       string    `json:"sku"`
	Price     float64   `json:"price"`
	Stock     int       `json:"stock"`
	Category  string    `json:"category"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type productInput struct {
	Name     string  `json:"name"`
	SKU      string  `json:"sku"`
	Price    float64 `json:"price"`
	Stock    int     `json:"stock"`
	Category string  `json:"category"`
}

func (in productInput) validate() string {
	switch {
	case in.Name == "":
		return "name is required"
	case in.SKU == "":
		return "sku is required"
	case in.Price < 0:
		return "price must be >= 0"
	case in.Stock < 0:
		return "stock must be >= 0"
	}
	return ""
}

type scanner interface{ Scan(dest ...any) error }

func scanProduct(s scanner) (Product, error) {
	var p Product
	err := s.Scan(&p.ID, &p.Name, &p.SKU, &p.Price, &p.Stock, &p.Category, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}

func decodeProduct(w http.ResponseWriter, r *http.Request) (productInput, bool) {
	var in productInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, "invalid JSON")
		return in, false
	}
	if msg := in.validate(); msg != "" {
		writeErr(w, 400, msg)
		return in, false
	}
	return in, true
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// bumpVersion invalidates every cached list page at once (the version is part of the list cache key).
func (a *App) bumpVersion(r *http.Request) {
	if err := a.rdb.Incr(r.Context(), "products:ver").Err(); err != nil {
		log.Printf("cache version bump failed: %v", err)
	}
}

func (a *App) maybeLowStock(r *http.Request, p Product) {
	if p.Stock < a.cfg.LowStock {
		if err := a.enqueue(r.Context(), Job{Type: "low_stock", ProductID: p.ID}); err != nil {
			log.Printf("enqueue low_stock failed: %v", err)
		}
	}
}

func (a *App) getProduct(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	key := fmt.Sprintf("product:%d", id)

	// cache-aside: Dragonfly first; any cache error silently falls back to Postgres
	if s, err := a.rdb.Get(ctx, key).Result(); err == nil {
		w.Header().Set("X-Cache", "HIT")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(s))
		return
	}

	p, err := scanProduct(a.db.QueryRow(ctx, `SELECT `+productCols+` FROM products WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, 404, "product not found")
		return
	}
	if err != nil {
		writeErr(w, 500, "database error")
		return
	}
	b, _ := json.Marshal(p)
	if err := a.rdb.Set(ctx, key, b, productTTL).Err(); err != nil {
		log.Printf("cache set failed: %v", err)
	}
	w.Header().Set("X-Cache", "MISS")
	w.Header().Set("Content-Type", "application/json")
	w.Write(b)
}

func (a *App) listProducts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 20
	}
	category := q.Get("category")

	ver, err := a.rdb.Get(ctx, "products:ver").Result()
	if err != nil {
		ver = "0"
	}
	key := fmt.Sprintf("products:list:v%s:%s:%d:%d", ver, category, page, limit)
	if s, err := a.rdb.Get(ctx, key).Result(); err == nil {
		w.Header().Set("X-Cache", "HIT")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(s))
		return
	}

	var total int
	if err := a.db.QueryRow(ctx,
		`SELECT count(*) FROM products WHERE ($1 = '' OR category = $1)`, category).Scan(&total); err != nil {
		writeErr(w, 500, "database error")
		return
	}
	rows, err := a.db.Query(ctx,
		`SELECT `+productCols+` FROM products WHERE ($1 = '' OR category = $1) ORDER BY id DESC LIMIT $2 OFFSET $3`,
		category, limit, (page-1)*limit)
	if err != nil {
		writeErr(w, 500, "database error")
		return
	}
	defer rows.Close()
	items := []Product{}
	for rows.Next() {
		p, err := scanProduct(rows)
		if err != nil {
			writeErr(w, 500, "database error")
			return
		}
		items = append(items, p)
	}
	if rows.Err() != nil {
		writeErr(w, 500, "database error")
		return
	}

	b, _ := json.Marshal(map[string]any{"data": items, "page": page, "limit": limit, "total": total})
	if err := a.rdb.Set(ctx, key, b, listTTL).Err(); err != nil {
		log.Printf("cache set failed: %v", err)
	}
	w.Header().Set("X-Cache", "MISS")
	w.Header().Set("Content-Type", "application/json")
	w.Write(b)
}

func (a *App) createProduct(w http.ResponseWriter, r *http.Request) {
	in, ok := decodeProduct(w, r)
	if !ok {
		return
	}
	p, err := scanProduct(a.db.QueryRow(r.Context(),
		`INSERT INTO products(name, sku, price, stock, category) VALUES($1,$2,$3,$4,$5) RETURNING `+productCols,
		in.Name, in.SKU, in.Price, in.Stock, in.Category))
	if err != nil {
		if isUniqueViolation(err) {
			writeErr(w, 409, "sku already exists")
			return
		}
		writeErr(w, 500, "database error")
		return
	}
	a.bumpVersion(r)
	a.maybeLowStock(r, p)
	writeJSON(w, 201, p)
}

func (a *App) updateProduct(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	in, ok := decodeProduct(w, r)
	if !ok {
		return
	}
	p, err := scanProduct(a.db.QueryRow(r.Context(),
		`UPDATE products SET name=$1, sku=$2, price=$3, stock=$4, category=$5, updated_at=now()
		 WHERE id=$6 RETURNING `+productCols,
		in.Name, in.SKU, in.Price, in.Stock, in.Category, id))
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, 404, "product not found")
		return
	}
	if err != nil {
		if isUniqueViolation(err) {
			writeErr(w, 409, "sku already exists")
			return
		}
		writeErr(w, 500, "database error")
		return
	}
	a.rdb.Del(r.Context(), fmt.Sprintf("product:%d", id))
	a.bumpVersion(r)
	a.maybeLowStock(r, p)
	writeJSON(w, 200, p)
}

func (a *App) deleteProduct(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	tag, err := a.db.Exec(r.Context(), `DELETE FROM products WHERE id = $1`, id)
	if err != nil {
		writeErr(w, 500, "database error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 404, "product not found")
		return
	}
	a.rdb.Del(r.Context(), fmt.Sprintf("product:%d", id))
	a.bumpVersion(r)
	w.WriteHeader(http.StatusNoContent)
}
