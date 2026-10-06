export type User = { id: number; email: string };
export type Session = { token: string; user: User };
export type Product = {
  id: number;
  name: string;
  sku: string;
  price: number;
  stock: number;
  category: string;
  created_at: string;
  updated_at: string;
};
export type ProductInput = Pick<
  Product,
  "name" | "sku" | "price" | "stock" | "category"
>;
export type ProductPage = {
  data: Product[];
  page: number;
  limit: number;
  total: number;
};
export type ImportJob = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  total_rows: number;
  processed_rows: number;
  failed_rows: number;
  error: string;
  created_at: string;
};
export type LiveEvent = {
  channel: string;
  data: {
    type: string;
    job_id?: string;
    status?: string;
    product_id?: number;
    name?: string;
    stock?: number;
  };
};

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"
).replace(/\/$/, "");
export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || `${API_URL.replace(/^http/, "ws")}/ws`;
const configuredThreshold = Number(
  process.env.NEXT_PUBLIC_LOW_STOCK_THRESHOLD ?? "5",
);
export const LOW_STOCK_THRESHOLD =
  Number.isFinite(configuredThreshold) && configuredThreshold >= 0
    ? configuredThreshold
    : 5;
const SESSION_KEY = "precision-session";

export function readSession(): Session | null {
  try {
    const session: Session = JSON.parse(
      sessionStorage.getItem(SESSION_KEY) || "null",
    );
    if (!session?.token || !session.user?.id || !session.user.email)
      return null;
    const payload = JSON.parse(
      atob(session.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function writeSession(session: Session | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* The current in-memory session still works when storage is disabled. */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError(
      "Cannot reach the server. Check that the backend is running.",
      0,
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 401 && token)
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(
      body?.error || `Request failed (${response.status}).`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  authenticate: (mode: "login" | "register", email: string, password: string) =>
    request<Session>(`/auth/${mode}`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  products: (
    page: number,
    limit: number,
    category: string,
    signal?: AbortSignal,
  ) =>
    request<ProductPage>(
      `/products?${new URLSearchParams({ page: String(page), limit: String(limit), category })}`,
      { signal },
    ),
  saveProduct: (input: ProductInput, token: string, id?: number) =>
    request<Product>(
      id ? `/products/${id}` : "/products",
      { method: id ? "PUT" : "POST", body: JSON.stringify(input) },
      token,
    ),
  deleteProduct: (id: number, token: string) =>
    request<void>(`/products/${id}`, { method: "DELETE" }, token),
  upload: (file: File, token: string) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ job_id: string; status: "queued" }>(
      "/products/import",
      { method: "POST", body: form },
      token,
    );
  },
  importStatus: (id: string, token: string, signal?: AbortSignal) =>
    request<ImportJob>(`/imports/${encodeURIComponent(id)}`, { signal }, token),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
