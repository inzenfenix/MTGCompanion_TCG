// Imprime el código TOTP vigente de una cuenta de demo (secreto en <DEMO_DIR>/<cuenta>.totp, fuera del repo).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(join(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/backend'), 'package.json'));
const { generate } = require('otplib');
const dir = process.env.DEMO_DIR ?? '/mnt/SSDGames/mtg-video/work';
console.log(await generate({ secret: readFileSync(join(dir, `${process.argv[2]}.totp`), 'utf8').trim() }));
