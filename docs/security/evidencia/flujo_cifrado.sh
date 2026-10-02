#!/usr/bin/env bash
# Evidencia de funcionamiento — Actividad N°2 (ROADMAP.md O9 / issue #35).
#
# Recorre los flujos reales de la API con los campos del jugador cifrados
# (secreto TOTP y ubicación) y muestra, en cada paso, qué guarda Postgres.
# Requisitos: backend corriendo en $API (npm run start / node dist/main;
# opcional BACKEND_LOG=<archivo de log> para mostrar el error del paso 10),
# Postgres de desarrollo (apps/backend/docker/dev.sh up), jq, docker.
#
#   bash docs/security/evidencia/flujo_cifrado.sh > docs/security/evidencia/04_flujo_cifrado.txt
#
# Crea cuentas de prueba nuevas en cada corrida (sufijo con timestamp); no
# toca datos existentes. Los tokens de sesión se truncan al imprimirlos.
set -euo pipefail

API=${API:-http://localhost:3000}
PG_CONTAINER=${PG_CONTAINER:-mtg-companion-dev-postgres-1}
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../apps/backend" && pwd)"
TS=$(date +%s)
SELLER="vendedor.$TS@evidencia.test"
BUYER="comprador.$TS@evidencia.test"
PASS='Evidencia-2026!'

say()  { printf '\n=== %s ===\n' "$*"; }
post() { curl -sS -X POST "$API$1" -H 'Content-Type: application/json' ${3:+-H "Authorization: Bearer $3"} -d "$2"; }
psql_q() { docker exec "$PG_CONTAINER" psql -U mtg -d mtg_companion -c "$1"; }
totp() { (cd "$BACKEND_DIR" && node --input-type=module -e "import {generate} from 'otplib'; console.log(await generate({secret: process.argv[1]}))" "$1"); }
short() { cut -c1-24 | sed 's/$/…/'; }

echo "Fecha: $(date -Iseconds)"
echo "API:   $API"

say "1. Registro del vendedor y login (sin 2FA todavía)"
post /users/register "{\"email\":\"$SELLER\",\"password\":\"$PASS\",\"displayName\":\"Vendedor Evidencia\"}" | jq -c '{id, email}'
SELLER_TOKEN=$(post /auth/login "{\"email\":\"$SELLER\",\"password\":\"$PASS\"}" | jq -r .accessToken)
echo "accessToken: $(echo "$SELLER_TOKEN" | short)"

say "2. Contraseña: la BD guarda solo el hash bcrypt (se valida, nunca se recupera)"
psql_q "SELECT email, left(\"passwordHash\", 29) || '…' AS password_hash FROM users WHERE email = '$SELLER';"

say "3. POST /auth/2fa/setup — el backend genera el secreto TOTP y lo devuelve una vez (para el QR)"
SETUP=$(post /auth/2fa/setup '{}' "$SELLER_TOKEN")
SECRET=$(echo "$SETUP" | jq -r .secret)
echo "secreto devuelto al cliente (una sola vez): $SECRET"

say "4. Lo que guarda Postgres: AES-256-GCM, formato v1:<iv>:<tag>:<ciphertext> — NO el secreto"
psql_q "SELECT u.email, s.\"twoFactorEnabled\", s.\"twoFactorSecret\" FROM user_settings s JOIN users u ON u.id = s.\"userId\" WHERE u.email = '$SELLER';"
STORED=$(docker exec "$PG_CONTAINER" psql -U mtg -d mtg_companion -tAc "SELECT s.\"twoFactorSecret\" FROM user_settings s JOIN users u ON u.id = s.\"userId\" WHERE u.email = '$SELLER';")
if [[ "$STORED" == *"$SECRET"* ]]; then echo "FALLA: el secreto aparece en texto plano en la BD"; exit 1; else echo "OK: el valor en la BD no contiene el secreto en claro"; fi

say "5. POST /auth/2fa/enable — el backend DESCIFRA el secreto para validar el código TOTP"
post /auth/2fa/enable "{\"code\":\"$(totp "$SECRET")\"}" "$SELLER_TOKEN"; echo

say "6. Login con 2FA: paso 1 devuelve un desafío firmado; paso 2 valida el código contra el secreto descifrado"
CHALLENGE=$(post /auth/login "{\"email\":\"$SELLER\",\"password\":\"$PASS\"}")
echo "$CHALLENGE" | jq -c '{twoFactorRequired, twoFactorToken: (.twoFactorToken[0:24] + "…")}'
TFA_TOKEN=$(echo "$CHALLENGE" | jq -r .twoFactorToken)
echo "código incorrecto:"
post /auth/2fa/verify "{\"twoFactorToken\":\"$TFA_TOKEN\",\"code\":\"000000\"}" | jq -c '{statusCode, message}'
echo "código correcto (generado desde el secreto, como lo haría la app autenticadora):"
SELLER_TOKEN=$(post /auth/2fa/verify "{\"twoFactorToken\":\"$TFA_TOKEN\",\"code\":\"$(totp "$SECRET")\"}" | jq -r .accessToken)
echo "accessToken: $(echo "$SELLER_TOKEN" | short)"

say "7. PATCH /users/me/location — ubicación del vendedor (Santiago), dato personal"
curl -sS -X PATCH "$API/users/me/location" -H 'Content-Type: application/json' -H "Authorization: Bearer $SELLER_TOKEN" \
  -d '{"lat":-33.4489,"lng":-70.6693}' -o /dev/null -w 'HTTP %{http_code}\n'
psql_q "SELECT u.email, pg_typeof(s.\"lastLat\") AS tipo, s.\"lastLat\", s.\"lastLng\" FROM user_settings s JOIN users u ON u.id = s.\"userId\" WHERE u.email = '$SELLER';"

say "8. El vendedor publica una carta"
post /cards "{\"title\":\"Evidencia $TS\",\"guessedPrice\":12.5}" "$SELLER_TOKEN" | jq -c '{id, title}'

say "9. Un comprador (Valparaíso) busca: el backend descifra la ubicación SOLO para calcular la distancia"
post /users/register "{\"email\":\"$BUYER\",\"password\":\"$PASS\",\"displayName\":\"Comprador Evidencia\"}" > /dev/null
BUYER_TOKEN=$(post /auth/login "{\"email\":\"$BUYER\",\"password\":\"$PASS\"}" | jq -r .accessToken)
curl -sS "$API/cards?q=Evidencia%20$TS&lat=-33.0472&lng=-71.6127" -H "Authorization: Bearer $BUYER_TOKEN" \
  | jq -c '.[] | {title, ownerDisplayName, distanceKm, respuesta_incluye_coordenadas: (has("ownerLat") or has("ownerLng"))}'
echo "(distanceKm ≈ 100 km Santiago–Valparaíso; la respuesta no incluye coordenadas: nunca salen del backend)"

say "10. Integridad: si alguien altera el texto cifrado en la BD, el backend lo rechaza (GCM) en vez de usar un valor falso"
docker exec "$PG_CONTAINER" psql -U mtg -d mtg_companion -tAc \
  "UPDATE user_settings s SET \"twoFactorSecret\" = regexp_replace(s.\"twoFactorSecret\", ':[A-Za-z0-9+/]', ':A', 'g') FROM users u WHERE u.id = s.\"userId\" AND u.email = '$SELLER';" > /dev/null
echo "login del vendedor con el secreto alterado:"
CHALLENGE=$(post /auth/login "{\"email\":\"$SELLER\",\"password\":\"$PASS\"}")
echo "$CHALLENGE" | jq -c '{statusCode, message}'
echo "(falla cerrado con un 500 genérico — no filtra detalles al cliente; la cuenta no se puede usar con un secreto manipulado)"
if [ -n "${BACKEND_LOG:-}" ]; then
  echo "log del servidor:"
  grep -a "FieldEncryptionError\|failed authentication" "$BACKEND_LOG" | tail -1 | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-160
fi

say "Fin"
