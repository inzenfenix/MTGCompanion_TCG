// Chile's IVA (Impuesto al Valor Agregado) — 19%, and by law already
// included in any displayed/sale price ("precios con IVA incluido"). So
// Transaction.amount is the IVA-inclusive total; net and IVA are derived
// from it, not added on top of it.
export const IVA_RATE = 0.19;

export interface IvaBreakdown {
  net: number;
  iva: number;
  total: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeIvaBreakdown(amountInclIva: number): IvaBreakdown {
  const net = round2(amountInclIva / (1 + IVA_RATE));
  const total = round2(amountInclIva);
  // iva = total - net (not net * IVA_RATE) so the three numbers always sum
  // exactly, even after each has been independently rounded to 2dp.
  const iva = round2(total - net);
  return { net, iva, total };
}
