// Number formats for the demo console. Dates go through <DateTime>, never these.
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const whole = new Intl.NumberFormat("en-US");

export const money = (value: number) => dollars.format(value);
export const compact = (value: number) => compactNumber.format(value);
export const count = (value: number) => whole.format(value);
export const percent = (value: number) => `${value >= 0 ? "+" : ""}${String(Math.round(value))}%`;
