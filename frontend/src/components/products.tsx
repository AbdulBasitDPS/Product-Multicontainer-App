"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Plus,
  Search,
  Package,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
} from "lucide-react";
import {
  api,
  API_URL,
  errorMessage,
  LOW_STOCK_THRESHOLD,
  type Product,
  type ProductPage,
  type LiveEvent,
} from "@/lib/api";
import { useAuth } from "./auth-provider";
import { Modal } from "./modal";
import { ProductForm } from "./product-form";

export function StockBadge({ stock }: { stock: number }) {
  const type =
    stock === 0
      ? "danger"
      : stock < LOW_STOCK_THRESHOLD
        ? "warning"
        : "success";
  return (
    <span className={`badge ${type}`}>
      {stock === 0
        ? "Out of stock"
        : stock < LOW_STOCK_THRESHOLD
          ? "Low stock"
          : "In stock"}
    </span>
  );
}

export function Products() {
  const { session, ready } = useAuth();
  const params = useSearchParams();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [category, setCategory] = useState("");
  const [categoryInput, setCategoryInput] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<ProductPage>({
    data: [],
    page: 1,
    limit: 20,
    total: 0,
  });
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [details, setDetails] = useState<Product | null>(null);
  const highlight = params.get("highlight");
  const pages = Math.max(1, Math.ceil(data.total / limit));

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api
      .products(page, limit, category, controller.signal)
      .then((result) => {
        setData(result);
        setCategories((current) =>
          [
            ...new Set([
              ...current,
              ...result.data.map((p) => p.category).filter(Boolean),
            ]),
          ].sort(),
        );
        if (page > 1 && result.data.length === 0 && result.total > 0)
          setPage(Math.max(1, Math.ceil(result.total / limit)));
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(error));
          setData({ data: [], page, limit, total: 0 });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, limit, category, revision]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!highlight || !/^\d+$/.test(highlight)) return;
    const controller = new AbortController();
    fetch(`${API_URL}/products/${highlight}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Product no longer available.");
        return response.json() as Promise<Product>;
      })
      .then(setDetails)
      .catch((error) => {
        if (!controller.signal.aborted) setNotice(errorMessage(error));
      });
    return () => controller.abort();
  }, [highlight]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = (event: Event) => {
      const live = (event as CustomEvent<LiveEvent>).detail;
      if (live.data.type === "low_stock" || live.data.status === "completed") {
        clearTimeout(timer);
        timer = setTimeout(() => setRevision((v) => v + 1), 800);
      }
    };
    window.addEventListener("inventory-event", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("inventory-event", refresh);
    };
  }, []);

  const items = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.data.filter((p) =>
      `${p.name} ${p.sku}`.toLowerCase().includes(query),
    );
  }, [data.data, search]);

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCategory(categoryInput.trim());
    setPage(1);
  }
  function saved(product: Product) {
    setNotice(editing === "new" ? "Product added." : "Product updated.");
    setEditing(null);
    if (product.category)
      setCategories((current) =>
        [...new Set([...current, product.category])].sort(),
      );
    setRevision((v) => v + 1);
  }
  async function remove() {
    if (!deleting || !session) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await api.deleteProduct(deleting.id, session.token);
      setDeleting(null);
      setNotice("Product deleted.");
      if (data.data.length === 1 && page > 1) setPage(page - 1);
      else setRevision((v) => v + 1);
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      setDeleteBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Products</h1>
          <p className="muted">Manage your catalog and stock.</p>
        </div>
        {session && (
          <button className="button primary" onClick={() => setEditing("new")}>
            <Plus size={17} />
            Add product
          </button>
        )}
      </div>
      {notice && (
        <div className="notice success-notice" role="status">
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <section
        className="card products-card"
        aria-label="Product catalog"
        aria-busy={loading}
      >
        <div className="toolbar">
          <label className="search-input">
            <Search size={17} />
            <input
              aria-label="Search this page by name or SKU"
              placeholder="Search this page..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <form className="category-filter" onSubmit={filter}>
            <input
              aria-label="Category filter"
              placeholder="All categories"
              list="categories"
              value={categoryInput}
              onChange={(event) => setCategoryInput(event.target.value)}
            />
            <datalist id="categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <button className="button secondary" disabled={loading}>
              Filter
            </button>
          </form>
          <button
            className="icon-button refresh-button"
            aria-label="Refresh products"
            title="Refresh"
            disabled={loading}
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw size={17} className={loading ? "spin" : ""} />
          </button>
        </div>
        {error ? (
          <div className="empty-state">
            <p className="error-message" role="alert">
              {error}
            </p>
            <button
              className="button secondary"
              onClick={() => setRevision((v) => v + 1)}
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="empty-state" role="status">
            <RefreshCw size={24} className="spin" />
            <p className="muted">Loading products...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">
              <Package size={28} />
            </span>
            <h2>
              {search || category ? "No matching products" : "No products yet"}
            </h2>
            <p className="muted">
              {search || category
                ? "Try a different search or category."
                : "Add a product or import a CSV to get started."}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Category</th>
                  <th className="numeric">Price</th>
                  <th className="numeric">Stock</th>
                  <th>Status</th>
                  {session && (
                    <th className="actions-column">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((product) => (
                  <tr key={product.id}>
                    <td data-label="Product">
                      <button
                        className="product-name"
                        onClick={() => setDetails(product)}
                      >
                        {product.name}
                      </button>
                    </td>
                    <td data-label="SKU" className="mono muted">
                      {product.sku}
                    </td>
                    <td data-label="Category">
                      {product.category || <span className="muted">—</span>}
                    </td>
                    <td data-label="Price" className="numeric mono">
                      {product.price.toFixed(2)}
                    </td>
                    <td
                      data-label="Stock"
                      className="numeric mono stock-number"
                    >
                      {product.stock}
                    </td>
                    <td data-label="Status">
                      <StockBadge stock={product.stock} />
                    </td>
                    {session && (
                      <td className="row-actions">
                        <button
                          className="icon-button"
                          title="Edit"
                          aria-label={`Edit ${product.name}`}
                          onClick={() => setEditing(product)}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="icon-button delete-action"
                          title="Delete"
                          aria-label={`Delete ${product.name}`}
                          onClick={() => {
                            setDeleting(product);
                            setDeleteError("");
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="table-footer">
          <span className="muted">
            {loading
              ? "Loading..."
              : search
                ? `${items.length} matches on this page · ${data.total} total`
                : `${data.total} products`}
          </span>
          <div className="pagination">
            <label className="page-size">
              Rows
              <select
                aria-label="Rows per page"
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            <span className="page-count">
              {page} / {pages}
            </span>
            <button
              className="icon-button"
              aria-label="Previous page"
              disabled={loading || page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Next page"
              disabled={loading || page >= pages}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </footer>
      </section>
      {ready && !session && (
        <p className="guest-note">
          <Link href="/login">Log in</Link> to add, edit, or import products.
        </p>
      )}
      {editing && session && (
        <ProductForm
          product={editing === "new" ? undefined : editing}
          token={session.token}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
      {deleting && session && (
        <Modal
          title="Delete product?"
          onClose={() => setDeleting(null)}
          busy={deleteBusy}
        >
          <div className="modal-body">
            <p>
              Delete <strong>{deleting.name}</strong>? This cannot be undone.
            </p>
            {deleteError && (
              <p className="error-message" role="alert">
                {deleteError}
              </p>
            )}
            <div className="form-actions">
              <button
                className="button secondary"
                disabled={deleteBusy}
                onClick={() => setDeleting(null)}
              >
                Cancel
              </button>
              <button
                className="button destructive"
                disabled={deleteBusy}
                onClick={remove}
              >
                {deleteBusy ? "Deleting..." : "Delete product"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {details && (
        <Modal title={details.name} onClose={() => setDetails(null)}>
          <div className="modal-body">
            <dl className="details-grid">
              <dt>SKU</dt>
              <dd className="mono">{details.sku}</dd>
              <dt>Category</dt>
              <dd>{details.category || "—"}</dd>
              <dt>Price</dt>
              <dd className="mono">{details.price.toFixed(2)}</dd>
              <dt>Stock</dt>
              <dd className="mono">{details.stock}</dd>
              <dt>Status</dt>
              <dd>
                <StockBadge stock={details.stock} />
              </dd>
            </dl>
            {session && (
              <div className="form-actions">
                <button
                  className="button primary"
                  onClick={() => {
                    setEditing(details);
                    setDetails(null);
                  }}
                >
                  Edit product
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
