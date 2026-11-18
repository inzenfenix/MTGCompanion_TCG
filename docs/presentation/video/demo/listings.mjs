// Escena 2: publica cartas en el Bazar con fotos reales del equipo (cartas sobre el paño, sin personas),
// usando el mismo flujo que la app: crear carta → URL prefirmada → subir a MinIO → confirmar la foto.
//   node docs/presentation/video/demo/listings.mjs <carpeta-de-fotos>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(resolve(HERE, '../../../../apps/backend'), 'package.json'));
const pg = require('pg');
const API = process.env.API ?? 'http://localhost:3000';
const PASS = process.env.DEMO_PASSWORD ?? 'DemoMTG-2026!';
const PHOTOS = resolve(process.argv[2] ?? '.');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://mtg:mtg@localhost:5432/mtg_companion' });
await db.connect();

async function call(method, path, { body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const login = async (who) => (await call('POST', '/auth/login', { body: { email: `${who}@example.com`, password: PASS } })).accessToken;

const LISTINGS = [
  ['ana', 'Casualties of War', 8.5, 'NM', '20260815_164338.jpg'],
  ['ana', 'Temple of Malady', 0.4, 'LP', '20260815_164150.jpg'],
  ['valentina', 'Second Harvest', 3, 'NM', '20260815_164225.jpg'],
  ['valentina', 'Bastion of Remembrance', 1.5, 'NM', '20260815_164520.jpg'],
  ['mateo', 'Plumb the Forbidden', 2, 'LP', '20260815_164300.jpg'],
  ['mateo', 'Saw in Half', 0.8, 'NM', '20260815_164021.jpg'],
];

const tokens = {};
for (const [who, title, price, condition, file] of LISTINGS) {
  tokens[who] ??= await login(who);
  const cat = (await db.query(`SELECT * FROM catalog_cards WHERE name = $1 LIMIT 1`, [title])).rows[0];
  const card = await call('POST', '/cards', {
    token: tokens[who],
    body: { title, guessedPrice: price, condition, scryfallId: cat?.id ?? cat?.scryfallId, setName: cat?.setName ?? cat?.set_name, rarity: cat?.rarity },
  });
  // Foto reducida a 1200 px (la original pesa ~4 MB) antes de subirla.
  const small = join(tmpdir(), `listing-${card.id}.jpg`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(PHOTOS, file), '-vf', 'scale=1200:-2', '-q:v', '3', small]);
  const up = await call('POST', `/cards/${card.id}/photos/upload-url`, { token: tokens[who], body: { filename: 'foto.jpg', contentType: 'image/jpeg' } });
  const put = await fetch(up.uploadUrl ?? up.url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: readFileSync(small) });
  if (!put.ok) throw new Error(`PUT foto → ${put.status}`);
  await call('POST', `/cards/${card.id}/photos`, { token: tokens[who], body: { storageKey: up.storageKey ?? up.key, isPrimary: true } });
  console.log(`  ${who}: ${title} ($${price}, ${condition}) con foto`);
}
await db.end();
