import { randomBytes } from 'node:crypto';
import {
  ChainVerifier,
  computeAuditHash,
  type ChainRow,
  type ChainedFields,
} from './audit-chain';

// ROADMAP.md O15 / ACTIVIDAD_5.md §3.4 — tamper evidence of the audit log.
describe('audit hash chain', () => {
  const key = randomBytes(32);

  function chain(n: number): ChainRow[] {
    const rows: ChainRow[] = [];
    let prev: string | null = null;
    for (let i = 0; i < n; i++) {
      const fields: ChainedFields = {
        id: `id-${i}`,
        createdAt: new Date(1_700_000_000_000 + i * 1000),
        actorPseudonym: `u_${String(i).padStart(16, '0')}`,
        actorRole: 'USER',
        action: 'consent.grant',
        targetPseudonym: null,
        resourceType: 'consent',
        resourceRef: 'LOCATION_DISTANCE',
        reason: 'v1 via app',
        outcome: 'ALLOWED',
      };
      const hash = computeAuditHash(key, prev, fields);
      rows.push({ ...fields, seq: BigInt(i + 1), prevHash: prev, hash });
      prev = hash;
    }
    return rows;
  }

  const verify = (rows: ChainRow[], k = key) => {
    const v = new ChainVerifier(k);
    for (const r of rows) if (!v.feed(r)) break;
    return v.result;
  };

  it('an untouched chain verifies', () => {
    expect(verify(chain(5))).toMatchObject({
      ok: true,
      checked: 5,
      firstSeq: '1',
      lastSeq: '5',
    });
  });

  it('editing any field of a row breaks it at that row', () => {
    const rows = chain(5);
    rows[2] = { ...rows[2], outcome: 'DENIED' };
    expect(verify(rows)).toMatchObject({
      ok: false,
      brokenAt: { seq: '3', problem: 'hash-mismatch' },
    });
  });

  it('deleting a row from the middle breaks the link to the next one', () => {
    const rows = chain(5);
    rows.splice(2, 1);
    expect(verify(rows)).toMatchObject({
      ok: false,
      brokenAt: { seq: '4', problem: 'link-mismatch' },
    });
  });

  it('a forged row needs the key: recomputed with another key it fails', () => {
    const rows = chain(3);
    const forgedFields = { ...rows[1], reason: 'forged' };
    rows[1] = {
      ...forgedFields,
      hash: computeAuditHash(randomBytes(32), rows[0].hash, forgedFields),
    };
    expect(verify(rows).ok).toBe(false);
  });

  it('after retention removes the oldest rows, the first remaining row anchors the chain', () => {
    expect(verify(chain(6).slice(3))).toMatchObject({
      ok: true,
      checked: 3,
      firstSeq: '4',
    });
  });

  it('rows written before the chain existed (no hash) are skipped, not counted', () => {
    const legacy: ChainRow = {
      ...chain(1)[0],
      seq: 0n,
      hash: null,
      prevHash: null,
    };
    expect(verify([legacy, ...chain(2)])).toMatchObject({
      ok: true,
      checked: 2,
    });
  });
});
