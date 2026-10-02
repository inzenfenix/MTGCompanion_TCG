#!/usr/bin/env bash
# Evidencia de que las llaves/secretos no quedan expuestos — Actividad N°2
# (ROADMAP.md O9 / issue #35). Nunca imprime el valor de una llave.
#
#   bash docs/security/evidencia/llaves_no_expuestas.sh > docs/security/evidencia/05_llaves_no_expuestas.txt
#
# Requisitos: docker (imagen zricethezav/gitleaks), backend compilado
# (apps/backend: npm run build), apps/backend/.env con FIELD_ENCRYPTION_KEY.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BACKEND="$REPO/apps/backend"
cd "$REPO"
say() { printf '\n=== %s ===\n' "$*"; }

echo "Fecha: $(date -Iseconds)   commit: $(git rev-parse --short HEAD)"

say "1. gitleaks sobre TODO el historial de git (todas las ramas/commits)"
docker run --rm -v "$REPO:/repo:ro" zricethezav/gitleaks:latest git /repo --no-banner --redact 2>&1 \
  | sed 's/\x1b\[[0-9;]*m//g' | grep -E "commits scanned|leaks"
echo "(los 9 hallazgos revisados y descartados — contraseñas de cuentas desechables de los tests e2e —"
echo " están listados con su justificación en .gitleaksignore)"

say "2. Archivos con secretos reales: ignorados por git y nunca versionados"
for f in apps/backend/.env apps/mobile/.env infra/terraform/terraform.tfvars \
         infra/terraform/terraform.tfstate infra/terraform/terraform.tfstate.backup; do
  rule=$(git check-ignore -v "$f" 2>/dev/null | cut -f1)
  ever=$(git log --all --oneline -- "$f" "Proyecto/examen/${f#apps/}" "Proyecto/examen/$f" | wc -l)
  printf '%-42s ignorado por: %-32s commits que lo incluyeron: %s\n' "$f" "${rule:-NO IGNORADO}" "$ever"
done
echo "versionados solo los ejemplos (sin valores):"
git ls-files | grep -E '(^|/)\.env|tfvars|tfstate' | sed 's/^/  /'

say "3. La llave de cifrado local no aparece en ningún commit del historial"
KEY=$(grep '^FIELD_ENCRYPTION_KEY=' "$BACKEND/.env" | cut -d= -f2-)
if [ -n "$KEY" ]; then
  hits=$(git log --all -p | grep -c -F -- "$KEY")
  echo "longitud de la llave: $(printf '%s' "$KEY" | base64 -d 2>/dev/null | wc -c) bytes — apariciones en git log --all -p: $hits"
fi
echo "FIELD_ENCRYPTION_KEY en archivos versionados (placeholder vacío o referencia a variable — nunca un valor):"
git grep -n "FIELD_ENCRYPTION_KEY=" | sed 's/^/  /'

say "4. La BD no guarda la llave: solo el texto cifrado (la llave vive en la EC2 del backend / .env, no en Postgres)"
docker exec mtg-companion-dev-postgres-1 psql -U mtg -d mtg_companion -tAc \
  "SELECT count(*) || ' filas de user_settings con valores cifrados (v1:...)' FROM user_settings WHERE \"twoFactorSecret\" LIKE 'v1:%' OR \"lastLat\" LIKE 'v1:%';"

say "5. El backend se niega a arrancar en producción sin sus secretos (sin valor por defecto)"
EMPTY=$(mktemp -d)   # directorio sin .env, para que no se cargue el de desarrollo
run_boot() { (cd "$EMPTY" && env -i PATH="$PATH" "$@" timeout 20 node "$BACKEND/dist/main.js" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -m1 -E "Refusing|FIELD_ENCRYPTION_KEY is not set|Error:"); }
echo "a) NODE_ENV=production, sin JWT_SECRET ni FIELD_ENCRYPTION_KEY:"
run_boot NODE_ENV=production DATABASE_URL=postgresql://x@localhost/x | sed 's/^/   /'
echo "b) NODE_ENV=production, con JWT_SECRET pero sin FIELD_ENCRYPTION_KEY:"
run_boot NODE_ENV=production JWT_SECRET=dummy DATABASE_URL=postgresql://x@localhost/x | sed 's/^/   /'
echo "c) NODE_ENV=development sin FIELD_ENCRYPTION_KEY (tampoco hay llave por defecto en desarrollo):"
run_boot NODE_ENV=development DATABASE_URL=postgresql://x@localhost/x | sed 's/^/   /'
rm -rf "$EMPTY"

say "6. Separación y ubicación de cada secreto"
cat <<'EOF'
  FIELD_ENCRYPTION_KEY  AWS Secrets Manager (mtg-companion/field_encryption_key) -> .env del contenedor en la EC2 del backend
  JWT_SECRET            AWS Secrets Manager (mtg-companion/jwt_secret)           -> idem; llave distinta a la de cifrado
  MERCADOPAGO_*         AWS Secrets Manager                                     -> idem; nunca llega al cliente
  Postgres              EC2 separada: guarda solo el texto cifrado, sin acceso a Secrets Manager
  Dev                   apps/backend/.env (gitignoreado), llave generada localmente con openssl rand -base64 32
EOF
echo "deploy-backend.sh lee los secretos con el aws cli y arma el .env en memoria (nunca escribe un archivo local):"
grep -n 'field_encryption_key\|FIELD_ENCRYPTION_KEY' infra/terraform/scripts/deploy-backend.sh | sed 's/^/  /' | cut -c1-140
