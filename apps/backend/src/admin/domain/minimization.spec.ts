import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  coarsenCoordinate,
  isLocationFresh,
} from '../../users/domain/location-precision';
import { RegisterUserDto } from '../../users/presentation/dto/register-user.dto';
import { anonymizeSalesReport, ANONYMITY_K } from './k-anonymity';
import type { SalesAggregateRow } from './admin.repository';

describe('location minimization (ROADMAP.md O14)', () => {
  it('coarsens a GPS fix to 2 decimals (~1 km)', () => {
    expect(coarsenCoordinate(-33.4489123)).toBe(-33.45);
    expect(coarsenCoordinate(-70.6692655)).toBe(-70.67);
  });

  it('treats a location older than the TTL as absent', () => {
    const now = new Date('2026-10-23T12:00:00Z');
    expect(isLocationFresh(new Date('2026-10-20T12:00:00Z'), 30, now)).toBe(
      true,
    );
    expect(isLocationFresh(new Date('2026-09-01T12:00:00Z'), 30, now)).toBe(
      false,
    );
    expect(isLocationFresh(null, 30, now)).toBe(false);
  });
});

describe('RegisterUserDto — what registration may store', () => {
  const base = {
    email: 'ana@example.com',
    password: 'long-enough-1',
    displayName: 'Ana',
  };
  const errorsFor = async (body: object) =>
    (await validate(plainToInstance(RegisterUserDto, body))).map(
      (e) => e.property,
    );

  it('accepts the minimal set with the 18+ declaration', async () => {
    expect(await errorsFor({ ...base, adultConfirmed: true })).toEqual([]);
  });

  it('requires the 18+ declaration to be exactly true (no birth date asked)', async () => {
    expect(await errorsFor(base)).toContain('adultConfirmed');
    expect(await errorsFor({ ...base, adultConfirmed: false })).toContain(
      'adultConfirmed',
    );
  });

  it('rejects contact data in the public alias and overlong values', async () => {
    expect(
      await errorsFor({
        ...base,
        adultConfirmed: true,
        displayName: 'ana@example.com',
      }),
    ).toContain('displayName');
    expect(
      await errorsFor({
        ...base,
        adultConfirmed: true,
        displayName: 'x'.repeat(41),
      }),
    ).toContain('displayName');
    expect(
      await errorsFor({
        ...base,
        adultConfirmed: true,
        password: 'p'.repeat(73),
      }),
    ).toContain('password');
  });
});

describe('anonymized sales report (k-anonymity)', () => {
  const row = (buyers: number, sellers: number): SalesAggregateRow => ({
    month: '2026-10',
    condition: 'NM',
    paymentMethod: 'CASH',
    sales: Math.max(buyers, sellers),
    total: 1234.56,
    distinctBuyers: buyers,
    distinctSellers: sellers,
  });

  it(`publishes only cells backed by ≥ k=${ANONYMITY_K} distinct buyers AND sellers`, () => {
    const report = anonymizeSalesReport([row(5, 5), row(4, 9), row(9, 1)]);
    expect(report.k).toBe(5);
    expect(report.cells).toHaveLength(1);
    expect(report.suppressedCells).toBe(2);
  });

  it('carries no identifiers, no per-person counts, rounded totals', () => {
    const [cell] = anonymizeSalesReport([row(6, 7)]).cells;
    expect(Object.keys(cell).sort()).toEqual([
      'condition',
      'month',
      'paymentMethod',
      'sales',
      'total',
    ]);
    expect(cell.total).toBe(1235);
  });
});
