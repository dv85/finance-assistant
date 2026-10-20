export function resolveBudgetBasis(view, requestedBasis) {
  if (["purchase", "installments"].includes(requestedBasis)) return requestedBasis;
  return view === "budget" ? "installments" : "purchase";
}
