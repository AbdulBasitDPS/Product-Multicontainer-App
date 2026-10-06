"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="card empty-state">
      <h1>Something went wrong</h1>
      <p className="muted">Please try again.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
