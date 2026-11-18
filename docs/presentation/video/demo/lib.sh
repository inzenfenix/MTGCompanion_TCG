# Funciones para las demos de terminal del video (se cargan ocultas en cada .tape).
#   api <cuenta|-> MÉTODO RUTA [json]   petición a la API; muestra estado y cuerpo, nunca el token
#   sql "<consulta>"                    consulta a la BD local de demo
# Variables: DEMO_DIR (demo-state.json, tokens en caché), API.
export API=${API:-http://localhost:3000}
export DEMO_DIR=${DEMO_DIR:-/mnt/SSDGames/mtg-video/work}
export DEMO_PASSWORD=${DEMO_PASSWORD:-DemoMTG-2026!}
export PGPASSWORD=mtg
mkdir -p "$DEMO_DIR/tok" && rm -f "$DEMO_DIR"/tok/*   # tokens frescos en cada toma (expiran a los 15 min)

_state() { jq -r "$1" "$DEMO_DIR/demo-state.json"; }
_email() { _state ".users[\"$1\"].email"; }
uid() { _state ".users[\"$1\"].id"; }

_short() { sed -E 's/([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/\1…/g'; }

# Inicia sesión (en silencio) y guarda el token fuera de la pantalla.
login() {
  curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg e "$(_email "$1")" --arg p "$DEMO_PASSWORD" '{email:$e,password:$p}')" |
    jq -r '.accessToken // empty' > "$DEMO_DIR/tok/$1"
}
_tok() { [ -s "$DEMO_DIR/tok/$1" ] || login "$1"; cat "$DEMO_DIR/tok/$1"; }

# Nunca se muestran tokens en pantalla: todo campo *Token / *token se recorta.
_REDACT='walk(if type == "object" then with_entries(if (.key | test("[Tt]oken$")) and (.value | type == "string") then .value = (.value[:6] + "…(oculto)") else . end) else . end)'

# Imprime la respuesta: estado en color y cuerpo (JSON redactado; filtro opcional en $JQ).
_show() {
  local code=$1 out=$2 color=32
  [ "$code" -ge 400 ] && color=31
  printf '\e[1;%sm◀ %s\e[0m\n' "$color" "$code"
  if [ -n "$out" ]; then
    printf %s "$out" | jq -C "$_REDACT | ${JQ:-.}" 2>/dev/null | _short || printf '%s\n' "$out"
  fi
  echo
}

# _req MÉTODO RUTA [json] [token] → deja la respuesta en $_OUT y el estado en $_CODE.
_req() {
  local auth=()
  [ -n "${4:-}" ] && auth=(-H "Authorization: Bearer $4")
  _OUT=$(curl -s -w '\n%{http_code}' -X "$1" "$API$2" -H 'Content-Type: application/json' "${auth[@]}" ${3:+-d "$3"})
  _CODE=${_OUT##*$'\n'}; _OUT=${_OUT%$'\n'*}
}

api() {
  local who=$1 method=$2 path=$3 body=${4:-} tok="" label="sin sesión"
  if [ "$who" != "-" ]; then tok=$(_tok "$who"); label="$who"; fi
  printf '\e[2m▶ %s\e[0m  \e[1m%s %s\e[0m\n' "$label" "$method" "$(printf %s "$path" | _short)"
  _req "$method" "$path" "$body" "$tok"
  _show "$_CODE" "$_OUT"
}

# Inicio de sesión completo con 2FA: contraseña + código TOTP de la app autenticadora.
login_2fa() {
  local who=$1 ttok code
  printf '\e[2m▶ %s\e[0m  \e[1mPOST /auth/login\e[0m  (contraseña)\n' "$who"
  _req POST /auth/login "$(jq -nc --arg e "$(_email "$who")" --arg p "$DEMO_PASSWORD" '{email:$e,password:$p}')"
  ttok=$(printf %s "$_OUT" | jq -r '.twoFactorToken // empty')
  if [ "$_CODE" -ge 400 ]; then _show "$_CODE" "$_OUT"; return; fi
  JQ='{twoFactorRequired}' _show "$_CODE" "$_OUT"
  code=$(node "$(dirname "${BASH_SOURCE[0]}")/totp.mjs" "$who")
  printf '\e[2m▶ %s\e[0m  \e[1mPOST /auth/2fa/verify\e[0m  (código de 6 dígitos de la app)\n' "$who"
  _req POST /auth/2fa/verify "$(jq -nc --arg t "$ttok" --arg c "$code" '{twoFactorToken:$t,code:$c}')"
  if [ "$_CODE" -lt 400 ]; then JQ='{accessToken, "sesión": "iniciada ✔"}' _show "$_CODE" "$_OUT"; else _show "$_CODE" "$_OUT"; fi
}

# En las consultas, @marta se reemplaza por 'marta@example.com' (más legible en pantalla).
sql() {
  local q
  q=$(printf %s "$1" | sed -E "s/@([a-z]+)\\b/'\\1@example.com'/g")
  psql -h localhost -U mtg "${DB:-mtg_companion}" -P pager=off -P footer=off -c "$q" | _short
}

# Escena 6: copia de la BD de demo para anonimizarla (nunca se anonimiza la original).
copia_bd() {
  local c=mtg-companion-dev-postgres-1
  docker exec $c dropdb -U mtg --if-exists "$1" 2>/dev/null && docker exec $c createdb -U mtg "$1" &&
    docker exec $c sh -c "pg_dump -U mtg mtg_companion | psql -q -U mtg $1" >/dev/null 2>&1
  printf 'copia lista: \e[1m%s\e[0m (%s usuarios)\n\n' "$1" "$(psql -h localhost -U mtg "$1" -Atc 'SELECT count(*) FROM users')"
}

# Escena 4: altera UN carácter del secreto 2FA cifrado de una cuenta, directo en la BD.
altera_cifrado() {
  local who=$1 before after pos=12 ch
  before=$(psql -h localhost -U mtg mtg_companion -Atc "SELECT \"twoFactorSecret\" FROM user_settings s JOIN users u ON u.id = s.\"userId\" WHERE u.email = '$(_email "$who")'")
  printf %s "$before" > "$DEMO_DIR/$who.cifrado.orig"
  ch=${before:$pos:1}; [ "$ch" = "A" ] && ch=B || ch=A
  after="${before:0:$pos}${ch}${before:$((pos + 1))}"
  psql -h localhost -U mtg mtg_companion -qc "UPDATE user_settings SET \"twoFactorSecret\" = '$after' WHERE \"userId\" = '$(uid "$who")'"
  printf 'antes:   %s\e[1;33m%s\e[0m%s\n' "${before:0:$pos}" "${before:$pos:1}" "${before:$((pos + 1)):40}…"
  printf 'después: %s\e[1;31m%s\e[0m%s\n\n' "${after:0:$pos}" "${after:$pos:1}" "${after:$((pos + 1)):40}…"
}
restaura_cifrado() {
  psql -h localhost -U mtg mtg_companion -qc "UPDATE user_settings SET \"twoFactorSecret\" = '$(cat "$DEMO_DIR/$1.cifrado.orig")' WHERE \"userId\" = '$(uid "$1")'"
}

# Escena 9: bandeja de MailHog (SMTP local) — correos de una cuenta, con asunto decodificado.
#   correos <cuenta> [n] [texto-del-asunto-para-mostrar-el-cuerpo]
correos() {
  curl -s "http://localhost:8025/api/v2/search?kind=to&query=$(_email "$1")&limit=${2:-4}" | python3 -c '
import email, json, sys
from email import policy
show = sys.argv[1].lower() if len(sys.argv) > 1 else ""
items = json.load(sys.stdin)["items"]
for it in items:
    m = email.message_from_string(it["Raw"]["Data"], policy=policy.default)
    hora, asunto, para = it["Created"][11:19], m["subject"], m["to"]
    print(f"\033[2m{hora}\033[0m  \033[1m{asunto}\033[0m  \033[2m→ {para}\033[0m")
if show:
    for it in items:
        m = email.message_from_string(it["Raw"]["Data"], policy=policy.default)
        if show in str(m["subject"]).lower():
            body = m.get_body(preferencelist=("plain",)).get_content().strip()
            print("\n" + "\n".join("  │ " + l for l in body.splitlines() if l.strip())[:900])
            break
' "${3:-}"
  echo
}

# Escena 11: id de la alerta más reciente de una regla.
alerta_id() {
  curl -s "$API/admin/security/alerts" -H "Authorization: Bearer $(_tok admin)" |
    jq -r --arg r "$1" '[.[] | select(.rule == $r)] | sort_by(.createdAt) | last | .id'
}

# Escena 11: alguien con acceso de dueño a la BD apaga el trigger y edita una fila
# de auditoría para borrar su rastro. Muestra qué cambió.
altera_auditoria() {
  local seq=$1
  psql -h localhost -U mtg mtg_companion -q -v ON_ERROR_STOP=1 <<SQL
ALTER TABLE audit_logs DISABLE TRIGGER USER;
UPDATE audit_logs SET outcome = 'DENIED' WHERE seq = $seq;
ALTER TABLE audit_logs ENABLE TRIGGER USER;
SQL
  printf 'fila seq %s editada a escondidas: outcome ALLOWED → \e[1;31mDENIED\e[0m\n\n' "$seq"
}

export PATH="${DEMO_TOOLS:-/mnt/SSDGames/mtg-video/tools}:$PATH"
export LOG=${LOG:-/mnt/SSDGames/mtg-video/backend.log}

export PS1='\[\e[1;35m\]mtg-companion\[\e[0m\] \[\e[2m\]$\[\e[0m\] '
clear
