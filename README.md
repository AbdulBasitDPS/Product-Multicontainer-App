# Shop Platform (backend, worker, Dragonfly, Postgres)

Containers: `backend` (Go API + WebSocket) · `worker` (Go worker pool) · `dragonfly` (cache, queue, pub/sub) · `postgres`.
Frontend (Next.js) runs at http://localhost:3000. See frontend/README.md for local development and configuration.

## Run
    docker compose up --build
    docker compose up --scale worker=3      # horizontal scaling

## Try it
    # register -> token
    curl -s -X POST localhost:8080/auth/register -H 'Content-Type: application/json' \
      -d '{"email":"me@test.com","password":"secret123"}'
    TOKEN=<paste token>

    # CRUD
    curl -s -X POST localhost:8080/products -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d '{"name":"Mouse","sku":"MS-1","price":19.99,"stock":3,"category":"electronics"}'
    curl -si localhost:8080/products/1 | grep -i x-cache     # MISS, then HIT
    curl -s  "localhost:8080/products?category=electronics&page=1&limit=20"
    curl -s -X PUT localhost:8080/products/1 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d '{"name":"Mouse","sku":"MS-1","price":24.99,"stock":50,"category":"electronics"}'
    curl -s -X DELETE localhost:8080/products/1 -H "Authorization: Bearer $TOKEN"

    # bulk import (background job) + status
    curl -s -X POST localhost:8080/products/import -H "Authorization: Bearer $TOKEN" -F file=@sample/products.csv
    curl -s localhost:8080/imports/<job_id> -H "Authorization: Bearer $TOKEN"

    # live events (progress + low-stock alerts)
    npx wscat -c ws://localhost:8080/ws

## API
| Method | Path | Auth |
|---|---|---|
| POST | /auth/register, /auth/login | no |
| GET | /products (page, limit, category), /products/{id} | no |
| POST / PUT / DELETE | /products, /products/{id} | JWT |
| POST | /products/import (multipart `file`; cols: name,sku,price,stock,category) | JWT |
| GET | /imports/{id} | JWT |
| GET | /ws | no |

## Design notes
- Cache-aside: `product:{id}` (5 min TTL); list pages keyed with a version counter `products:ver` (bumped on any write, so no key scanning). Responses carry `X-Cache: HIT|MISS`. If Dragonfly is down, the API falls back to Postgres.
- Queue: backend `LPUSH jobs`, worker `BRPOP jobs`. Job types: `import_csv`, `low_stock` (fired when stock < LOW_STOCK_THRESHOLD).
- Worker: `WORKER_COUNT` goroutines read a buffered channel; each CSV import is split into chunks processed in parallel (bounded by `CHUNK_WORKERS`) with batch upserts; retries (3 attempts), graceful shutdown on SIGTERM.
- Events: worker publishes to `job_progress` / `stock_alerts`; backend subscribes and pushes to WebSocket clients.
- The `uploads` volume is shared by backend and worker (the CSV lives there).

## Experiments
1. Import 2000 rows with `WORKER_COUNT`/`CHUNK_WORKERS` = 1 vs higher; compare times in the worker logs.
2. `docker compose stop dragonfly` and hit GET /products (falls back to Postgres).
3. `docker compose kill -s SIGTERM worker` mid-import to see the graceful drain.
4. `docker compose down` then `up`: data survives (pgdata volume); `down -v` wipes it.
