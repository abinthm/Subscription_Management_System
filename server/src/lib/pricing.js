const cents = (n) => Math.round(Number(n) * 100);
const units = (c) => c / 100;

export function isDiscountUsable(d, onDate) {
  return Boolean(d) && d.active
    && d.start_date <= onDate
    && (!d.end_date || d.end_date >= onDate)
    && (d.usage_limit == null || d.used_count < d.usage_limit);
}

function allocate(totalCents, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let left = totalCents;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return left;
    const share = sum ? Math.round((totalCents * w) / sum) : 0;
    left -= share;
    return share;
  });
}

export function priceLines(lines, discount = null) {
  const priced = lines.map((l) => ({ ...l, gross: cents(l.unit_price) * l.quantity, disc: 0 }));

  let discountApplied = false;
  if (discount) {
    const eligible = priced.filter((l) => discount.scope === 'subscription' || discount.product_ids.includes(l.product_id));
    const base = eligible.reduce((s, l) => s + l.gross, 0);
    const qty = eligible.reduce((s, l) => s + l.quantity, 0);
    if (eligible.length && base > 0 && base >= cents(discount.min_amount) && qty >= discount.min_quantity) {
      const amount = discount.type === 'percentage'
        ? Math.round((base * discount.value) / 100)
        : Math.min(cents(discount.value), base);
      allocate(amount, eligible.map((l) => l.gross)).forEach((share, i) => { eligible[i].disc = share; });
      discountApplied = amount > 0;
    }
  }

  let subtotal = 0, discountTotal = 0, taxTotal = 0;
  const out = priced.map(({ gross, disc, ...l }) => {
    const net = gross - disc;
    const tax = Math.round((net * Number(l.tax_rate ?? 0)) / 100);
    subtotal += gross;
    discountTotal += disc;
    taxTotal += tax;
    return { ...l, discount_amount: units(disc), tax_amount: units(tax), amount: units(net) };
  });

  return {
    lines: out,
    subtotal: units(subtotal),
    discount_total: units(discountTotal),
    tax_total: units(taxTotal),
    total: units(subtotal - discountTotal + taxTotal),
    discount_applied: discountApplied,
  };
}
