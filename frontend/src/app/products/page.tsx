import { Suspense } from "react";
import { Products } from "@/components/products";
export default function ProductsPage() {
  return (
    <Suspense fallback={<p className="muted">Loading products...</p>}>
      <Products />
    </Suspense>
  );
}
