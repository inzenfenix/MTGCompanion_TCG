import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIT_EVENTS, auditEventDef, isCatalogued } from './audit-events';

// ROADMAP.md O17 / ACTIVIDAD_7.md §1 — the catalog is the definition of
// "what is audited". This test keeps it honest: any action literal in the
// source that isn't catalogued fails here, so a new audited operation can't
// be added without saying what it is and which personal data it touches.

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

function actionsInSource(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/action:\s*['`]([^'`$]+)['`]/g)) {
      found.set(m[1], file);
    }
    for (const m of text.matchAll(
      /['`](security\.(?:containment|recovery)\.[a-z-]+)['`]/g,
    )) {
      found.set(m[1], file);
    }
  }
  return found;
}

describe('audit event catalog', () => {
  const inSource = actionsInSource();

  it('finds the audited actions in the source', () => {
    expect(inSource.size).toBeGreaterThan(30);
    expect(inSource.has('access.transaction.read')).toBe(true);
  });

  it('every action the code records is catalogued', () => {
    const missing: string[] = [];
    for (const [action, file] of inSource) {
      // Detection-rule prefixes ("access.", "denied ") count families of
      // events; at least one catalogued action must belong to each.
      if (action.endsWith('.') || action.endsWith(' ')) {
        const fam = Object.keys(AUDIT_EVENTS).some((a) => a.startsWith(action));
        if (!fam && !isCatalogued(`${action}GET /x`))
          missing.push(`${action}* (${file})`);
        continue;
      }
      if (!isCatalogued(action)) missing.push(`${action} (${file})`);
    }
    expect(missing).toEqual([]);
  });

  it('every catalogued event says what it is and what it stores', () => {
    for (const [action, def] of Object.entries(AUDIT_EVENTS)) {
      expect(def.description.length).toBeGreaterThan(5);
      expect(def.fields.length).toBeGreaterThan(0);
      if (def.kind === 'READ' && def.category === 'ACCESS') {
        expect(def.personalData.length).toBeGreaterThan(0);
      }
      expect(action).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    }
  });

  it('permission denials are catalogued as a family', () => {
    expect(auditEventDef('denied GET /admin/audit-logs')?.category).toBe(
      'SECURITY',
    );
  });

  it('reads of personal data by other people are catalogued as READ', () => {
    for (const a of [
      'access.transaction.read',
      'access.receipt.read',
      'access.profile.read',
      'access.location.distance',
      'admin.users.list',
      'support.transactions.read',
    ]) {
      expect(AUDIT_EVENTS[a].kind).toBe('READ');
    }
    expect(AUDIT_EVENTS['access.location.distance'].personalData).toContain(
      'geolocalización',
    );
  });
});
