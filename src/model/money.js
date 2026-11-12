// Pesos as people type and read them, centavos as the ledger stores them (spec 7.1).

// "95" -> 9500, "1,250.5" -> 125050, "₱20.00" -> 2000, "P1,250.50" and "PHP 1,250.50" too. At most two decimals; never rounds.
// A comma is read ONLY as the mark between thousands ("1,250", "12,345,678"). Anywhere else it is refused, never dropped: "1,5" used to become 15.00
// and "1,23" 123.00 (owner, Nov 12, L2), a silent tenfold or hundredfold mistake for someone who types a comma for the centavos.
export const AMOUNT_HINT = "Use a comma only between thousands, like 1,250.50. Use a point for centavos.";   // shown under the box
export const AMOUNT_COMMA = "use a comma only between thousands, like 1,250.50, and a point for centavos";
const PESOS = /^(?:₱|php|p)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/i;
export function parsePesos(input) {
  const s = String(input ?? "").trim();
  const m = PESOS.exec(s);
  if (!m) return { ok: false, error: /\d,|,\d/.test(s) && /^[₱phPH\s\d.,]+$/.test(s) ? AMOUNT_COMMA : "enter an amount like 95 or 95.50" };
  const centavos = Number(m[1].replace(/,/g, "")) * 100 + Number(((m[2] ?? "") + "00").slice(0, 2));
  return Number.isSafeInteger(centavos) ? { ok: true, centavos } : { ok: false, error: "amount is too large" };
}

// 125050 -> "₱1,250.50"; negative amounts keep their sign in front.
export function formatPesos(centavos) {
  const abs = Math.abs(centavos);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+$)/g, ",");
  return (centavos < 0 ? "-" : "") + "₱" + whole + "." + String(abs % 100).padStart(2, "0");
}

// 1234567 -> "₱12,346": whole pesos, for tight spaces such as the label above a chart column.
export function formatPesosWhole(centavos) {
  const abs = Math.round(Math.abs(centavos) / 100);
  return (centavos < 0 && abs > 0 ? "-" : "") + "₱" + String(abs).replace(/\B(?=(\d{3})+$)/g, ",");
}
