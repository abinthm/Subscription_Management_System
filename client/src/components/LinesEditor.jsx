import { money } from '../lib.js';

export const emptyLine = () => ({ product_id: '', variant_id: '', quantity: 1 });

export function linePrice(line, products) {
  const product = products.find((p) => String(p.id) === String(line.product_id));
  if (!product) return 0;
  const variant = product.variants.find((v) => String(v.id) === String(line.variant_id));
  return Number(product.sales_price) + Number(variant?.extra_price ?? 0);
}

export default function LinesEditor({ lines, products, onChange, minQuantity = 1, showPrices = true, error }) {
  const update = (i, patch) => onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const remove = (i) => onChange(lines.filter((_, idx) => idx !== i));
  const subtotal = lines.reduce((s, l) => s + linePrice(l, products) * Number(l.quantity || 0), 0);

  return (
    <div className="full">
      <div className="table-wrap">
        <table className="lines-table">
          <thead>
            <tr><th>Product</th><th>Variant</th><th style={{ width: 110 }}>Quantity</th>{showPrices && <><th className="num">Unit price</th><th className="num">Amount</th></>}<th aria-label="Remove" /></tr>
          </thead>
          <tbody>
            {lines.map((line, i) => {
              const product = products.find((p) => String(p.id) === String(line.product_id));
              const price = linePrice(line, products);
              return (
                <tr key={i}>
                  <td style={{ minWidth: 200 }}>
                    <select className="input" value={line.product_id} onChange={(e) => update(i, { product_id: e.target.value, variant_id: '' })} aria-label={`Line ${i + 1} product`}>
                      <option value="">Select product</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td style={{ minWidth: 160 }}>
                    <select className="input" value={line.variant_id} disabled={!product?.variants.length} onChange={(e) => update(i, { variant_id: e.target.value })} aria-label={`Line ${i + 1} variant`}>
                      <option value="">{product?.variants.length ? 'Default' : '—'}</option>
                      {product?.variants.map((v) => (
                        <option key={v.id} value={v.id}>{v.attribute}: {v.value}{Number(v.extra_price) ? ` (+${money(v.extra_price)})` : ''}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="input" type="number" min={minQuantity} max={100000} value={line.quantity} onChange={(e) => update(i, { quantity: e.target.value })} aria-label={`Line ${i + 1} quantity`} />
                  </td>
                  {showPrices && <><td className="num">{money(price)}</td><td className="num">{money(price * Number(line.quantity || 0))}</td></>}
                  <td><button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => remove(i)} disabled={lines.length === 1} aria-label={`Remove line ${i + 1}`}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
          {showPrices && (
            <tfoot><tr><td colSpan={4} className="right muted">Subtotal before tax and discount</td><td className="num">{money(subtotal)}</td><td /></tr></tfoot>
          )}
        </table>
      </div>
      <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
        <button type="button" className="btn btn-sm" onClick={() => onChange([...lines, emptyLine()])}>+ Add line</button>
        {error && <small className="err" style={{ color: 'var(--danger)' }}>{error}</small>}
      </div>
    </div>
  );
}

export const toLinePayload = (lines) => lines.map((l) => ({
  product_id: Number(l.product_id) || null,
  variant_id: Number(l.variant_id) || null,
  quantity: Number(l.quantity),
}));
