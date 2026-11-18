# Escena 6 — Actividad 4: seudonimización (auditoría, subastas) y anonimización (reporte k=5, copia de desarrollo).
Output ../../assets/clips/s06_seudonimos.mp4
Source "ajustes.tape"
Set FontSize 24
Hide
Type "source ../lib.sh && COPIA=postgresql://mtg:mtg@localhost:5432/mtg_copia_dev && BACKEND=../../../../../apps/backend" Enter
Sleep 500ms
Show
Type "# Auditoría: quién actuó y a quién afectó, como seudónimo HMAC — nunca el id real ni el correo" Enter
Type `sql 'SELECT seq, "actorPseudonym", "actorRole", action, "targetPseudonym", outcome FROM audit_logs WHERE "actorRole" IS NOT NULL ORDER BY seq DESC LIMIT 6'` Enter
Sleep 4s
Type "clear" Enter
Type "# Subastas: pedro y bruno pujan en dos cartas. Cada postor tiene un alias distinto por subasta" Enter
Type `JQ='[.offers[] | {bidderAlias, amount}]' api - GET /cards/$(_state .cards.subasta1)/offers` Enter
Sleep 2500ms
Type `JQ='[.offers[] | {bidderAlias, amount}]' api - GET /cards/$(_state .cards.subasta2)/offers` Enter
Sleep 4s
Type "clear" Enter
Type "# Reporte de ventas: anonimizado con k-anonimato (k = 5): solo celdas con ≥5 compradores y ≥5 vendedores" Enter
Type "api admin GET /admin/reports/sales" Enter
Sleep 4s
Type "clear" Enter
Type "# Copias para desarrollo: se anonimiza una COPIA de la base, nunca la original" Enter
Type "copia_bd mtg_copia_dev" Enter
Sleep 4s
Type `NODE_ENV=development DATABASE_URL=$COPIA npm --prefix $BACKEND run -s db:anonymize -- --confirm-dev-copy | grep -o "anonymized.*emptied"` Enter
Sleep 8s
Type `DB=mtg_copia_dev sql 'SELECT email, "displayName", "lastLat" FROM users u JOIN user_settings s ON s."userId" = u.id LIMIT 5'` Enter
Sleep 5s
