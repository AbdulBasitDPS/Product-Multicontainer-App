package main

import (
	"os"
	"strconv"
)

type Config struct {
	Port        string
	DatabaseURL string
	RedisAddr   string
	JWTSecret   string
	UploadDir   string
	CORSOrigin  string
	LowStock    int
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func loadConfig() Config {
	th, err := strconv.Atoi(env("LOW_STOCK_THRESHOLD", "5"))
	if err != nil {
		th = 5
	}
	return Config{
		Port:        env("PORT", "8080"),
		DatabaseURL: env("DATABASE_URL", "postgres://shop:shop_secret@localhost:5432/shop?sslmode=disable"),
		RedisAddr:   env("REDIS_ADDR", "localhost:6379"),
		JWTSecret:   env("JWT_SECRET", "dev-secret-change-me"),
		UploadDir:   env("UPLOAD_DIR", "/app/uploads"),
		CORSOrigin:  env("CORS_ORIGIN", "*"),
		LowStock:    th,
	}
}
