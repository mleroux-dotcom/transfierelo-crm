export const money = (n: unknown) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n) || 0);

export const date = (s: unknown) =>
  s ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(new Date(String(s) + "T00:00:00")) : "—";

export const today = () => new Date().toISOString().slice(0, 10);

export const fullName = (c: { first_name?: unknown; last_name?: unknown }) =>
  [c.first_name, c.last_name].filter(Boolean).join(" ");
