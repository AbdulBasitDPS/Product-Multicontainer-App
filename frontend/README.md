# Frontend

Simple Next.js / TypeScript inventory UI: login, registration, product CRUD, category filtering, pagination, CSV imports, and live stock alerts.

## Run everything with Docker

From the repository root:

```powershell
docker compose up --build -d
```

Open http://localhost:3000. PostgreSQL, Dragonfly, the backend, and worker start with the frontend.

## Develop the frontend locally

Start the existing services from the repository root:

```powershell
docker compose up --build -d postgres dragonfly backend worker
```

Then:

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. The default API is http://localhost:8080 and the default WebSocket is ws://localhost:8080/ws.

For custom settings, copy .env.example to .env.local and edit it. NEXT_PUBLIC_LOW_STOCK_THRESHOLD should match the backend LOW_STOCK_THRESHOLD. Restart after changing environment values. Docker passes its browser URLs as build arguments; set NEXT_PUBLIC_API_URL and NEXT_PUBLIC_WS_URL in the root .env before rebuilding if accessing from another host.

Ensure backend CORS_ORIGIN allows http://localhost:3000 (the current wildcard also works for these bearer-token requests).

## Behavior

- Authentication tokens are stored in sessionStorage for the current browser tab and expire after 24 hours. Closing the tab clears the session. The backend validates all protected actions. No JWT signing secret belongs in the frontend.
- Product reads are public. Creating, editing, deleting, and importing require login.
- Category filtering uses exact category names. Search filters only the current page. Category suggestions come from products already loaded.
- Prices are displayed as decimal values without assuming a currency; the backend has no currency field.
- Imports upsert products by SKU. Rejected rows remain visible even when an import completes.
- Recent import references are stored per user in this browser, limited to 20 entries. This is not a server-side import-history endpoint.
- Import status is fetched every two seconds while active. WebSocket events trigger additional status checks; reconnect uses bounded backoff.
- Stock events are broadcast globally by the existing backend.

## Checks

```powershell
npm run build
npm run typecheck
```

The UI uses local font fallbacks to avoid requiring a font download during builds.

## Browser integration checks

With the frontend and backend running:

```powershell
npm run test:e2e
```

Checks use installed Google Chrome. Set UI_TEST_BROWSER_CHANNEL=msedge to use Edge instead. To use downloaded Chromium, adjust the channel in playwright.config.ts.

These checks register a unique example.test account, exercise product CRUD and a CSV import, and remove their temporary products afterward. Import records and test accounts remain in the database. Screenshots and failure traces are written to the ignored test-results directory.
