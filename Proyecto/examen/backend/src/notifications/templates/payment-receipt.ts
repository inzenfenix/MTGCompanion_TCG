// Same "informal receipt, not a real SII-authorized boleta electrónica"
// disclaimer TransactionsService.getReceipt() already carries — Chile's
// e-invoicing system needs SII registration/certification this project
// doesn't have, so the disclaimer travels into the email body itself
// (ROADMAP.md J8's own note), not just the app UI.
const DISCLAIMER =
  'Comprobante interno generado por MTG Companion — no constituye una boleta ' +
  'o factura electrónica autorizada por el SII.';

export function renderPaymentReceiptEmail(params: {
  cardTitle: string;
  paymentMethod: string;
  net: number;
  iva: number;
  total: number;
}): { subject: string; html: string; text: string } {
  const { cardTitle, paymentMethod, net, iva, total } = params;
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const subject = `Receipt: ${cardTitle}`;
  const text =
    `Your purchase is confirmed.\n\n` +
    `Item: ${cardTitle}\n` +
    `Payment method: ${paymentMethod}\n` +
    `Net: ${fmt(net)}\n` +
    `IVA (19%): ${fmt(iva)}\n` +
    `Total: ${fmt(total)}\n\n` +
    `${DISCLAIMER}\n\n— MTG Companion`;
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h1 style="color:#7a1f2b;">Receipt</h1>
      <p>Your purchase of <strong>${cardTitle}</strong> is confirmed.</p>
      <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding:4px 0;">Payment method</td><td style="text-align:right;">${paymentMethod}</td></tr>
        <tr><td style="padding:4px 0;">Net</td><td style="text-align:right;">${fmt(net)}</td></tr>
        <tr><td style="padding:4px 0;">IVA (19%)</td><td style="text-align:right;">${fmt(iva)}</td></tr>
        <tr style="font-weight:bold; border-top: 1px solid #ccc;"><td style="padding:4px 0;">Total</td><td style="text-align:right;">${fmt(total)}</td></tr>
      </table>
      <p style="color:#888; font-size: 11px;">${DISCLAIMER}</p>
      <p style="color:#888; font-size: 12px;">— MTG Companion</p>
    </div>
  `.trim();
  return { subject, html, text };
}
