import type { SalesAggregateRow } from './admin.repository';

/**
 * Anonymization for reports (ROADMAP.md O14, docs/security/ACTIVIDAD_4.md
 * §2). The sales report never contains an id, a name or an exact date —
 * only month × card condition × payment method cells. That alone isn't
 * enough: a cell like "2026-10, DMG, CASH: 1 sale, $3.200" points straight
 * at one buyer and one seller anyone in the community could recognize.
 *
 * So a cell is only published when at least K distinct buyers AND K
 * distinct sellers are behind it (k-anonymity, k = 5); smaller cells are
 * dropped and only *how many* were dropped is reported. No grand total is
 * published either, so a suppressed cell can't be recovered by subtracting
 * the published ones from it. The distinct-buyer/seller counts themselves
 * are used for the check and then discarded, not returned.
 */
export const ANONYMITY_K = 5;

export interface SalesReportCell {
  month: string;
  condition: string;
  paymentMethod: string;
  sales: number;
  total: number;
}

export interface AnonymizedSalesReport {
  k: number;
  generatedAt: Date;
  cells: SalesReportCell[];
  suppressedCells: number;
}

export function anonymizeSalesReport(
  rows: SalesAggregateRow[],
  k: number = ANONYMITY_K,
  now: Date = new Date(),
): AnonymizedSalesReport {
  const cells: SalesReportCell[] = [];
  let suppressedCells = 0;
  for (const row of rows) {
    if (row.distinctBuyers < k || row.distinctSellers < k) {
      suppressedCells++;
      continue;
    }
    cells.push({
      month: row.month,
      condition: row.condition,
      paymentMethod: row.paymentMethod,
      sales: row.sales,
      total: Math.round(row.total),
    });
  }
  return { k, generatedAt: now, cells, suppressedCells };
}
