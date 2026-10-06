"use client";
import { useState, type FormEvent } from "react";
import { api, errorMessage, type Product } from "@/lib/api";
import { Modal } from "./modal";

export function ProductForm({
  product,
  token,
  onClose,
  onSaved,
}: {
  product?: Product;
  token: string;
  onClose: () => void;
  onSaved: (product: Product) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      name: String(form.get("name")).trim(),
      sku: String(form.get("sku")).trim(),
      price: Number(form.get("price")),
      stock: Number(form.get("stock")),
      category: String(form.get("category")).trim(),
    };
    if (!input.name || !input.sku) {
      setError("Name and SKU are required.");
      return;
    }
    if (
      !Number.isFinite(input.price) ||
      input.price < 0 ||
      !Number.isSafeInteger(input.stock) ||
      input.stock < 0
    ) {
      setError("Enter a valid price and a whole-number stock count.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      onSaved(await api.saveProduct(input, token, product?.id));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={product ? "Edit product" : "Add product"}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit} className="modal-body form-stack">
        <fieldset disabled={busy} className="form-stack">
          <label>
            Name
            <input
              name="name"
              defaultValue={product?.name}
              required
              maxLength={200}
              autoFocus
            />
          </label>
          <label>
            SKU
            <input
              name="sku"
              defaultValue={product?.sku}
              required
              maxLength={100}
              className="mono"
            />
          </label>
          <div className="form-grid">
            <label>
              Price
              <input
                name="price"
                type="number"
                min="0"
                max="99999999.99"
                step="0.01"
                defaultValue={product?.price ?? 0}
                required
              />
            </label>
            <label>
              Stock
              <input
                name="stock"
                type="number"
                min="0"
                max="2147483647"
                step="1"
                defaultValue={product?.stock ?? 0}
                required
              />
            </label>
          </div>
          <label>
            Category <span className="optional">optional</span>
            <input
              name="category"
              defaultValue={product?.category}
              maxLength={100}
            />
          </label>
        </fieldset>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving..." : "Save product"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
