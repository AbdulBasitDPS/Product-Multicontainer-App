package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (a *App) issueToken(id int64, email string) (string, error) {
	claims := jwt.MapClaims{
		"sub":   id,
		"email": email,
		"exp":   time.Now().Add(24 * time.Hour).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(a.cfg.JWTSecret))
}

func (a *App) register(w http.ResponseWriter, r *http.Request) {
	var c credentials
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		writeErr(w, 400, "invalid JSON")
		return
	}
	c.Email = strings.ToLower(strings.TrimSpace(c.Email))
	if c.Email == "" || len(c.Password) < 6 {
		writeErr(w, 400, "email required and password must be at least 6 characters")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(c.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, 500, "could not hash password")
		return
	}
	var id int64
	err = a.db.QueryRow(r.Context(),
		`INSERT INTO users(email, password_hash) VALUES($1, $2) RETURNING id`,
		c.Email, string(hash)).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeErr(w, 409, "email already registered")
			return
		}
		writeErr(w, 500, "database error")
		return
	}
	token, _ := a.issueToken(id, c.Email)
	writeJSON(w, 201, map[string]any{"token": token, "user": map[string]any{"id": id, "email": c.Email}})
}

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	var c credentials
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		writeErr(w, 400, "invalid JSON")
		return
	}
	c.Email = strings.ToLower(strings.TrimSpace(c.Email))
	var id int64
	var hash string
	err := a.db.QueryRow(r.Context(),
		`SELECT id, password_hash FROM users WHERE email = $1`, c.Email).Scan(&id, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, 401, "invalid credentials")
		return
	}
	if err != nil {
		writeErr(w, 500, "database error")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(c.Password)) != nil {
		writeErr(w, 401, "invalid credentials")
		return
	}
	token, _ := a.issueToken(id, c.Email)
	writeJSON(w, 200, map[string]any{"token": token, "user": map[string]any{"id": id, "email": c.Email}})
}

func (a *App) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			writeErr(w, 401, "missing bearer token")
			return
		}
		tok, err := jwt.Parse(strings.TrimPrefix(h, "Bearer "), func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, errors.New("unexpected signing method")
			}
			return []byte(a.cfg.JWTSecret), nil
		})
		if err != nil || !tok.Valid {
			writeErr(w, 401, "invalid or expired token")
			return
		}
		next.ServeHTTP(w, r)
	})
}
