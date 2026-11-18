# Escena 7 — Actividad 4: control de acceso por roles (USER / SUPPORT / ADMIN).
Output ../../assets/clips/s07_rbac.mp4
Source "ajustes.tape"
Set FontSize 24
Hide
Type "source ../lib.sh && TX_AJENA=$(_state .tx.lucia_sofia) && SOFIA=$(uid sofia) && ADMIN=$(uid admin)" Enter
Sleep 500ms
Show
Type "# Un usuario (marta) intenta leer una compra en la que no participa" Enter
Type "api marta GET /transactions/$TX_AJENA" Enter
Sleep 3s
Type "# Soporte puede revisar las compras de un jugador para una disputa... pero exige un motivo" Enter
Type "api support GET /admin/users/$SOFIA/transactions" Enter
Sleep 3s
Type "clear" Enter
Type `JQ='[.[] | {amount, status, paymentMethod}]' api support GET "/admin/users/$SOFIA/transactions?reason=Disputa%20412:%20carta%20no%20recibida"` Enter
Sleep 2500ms
Type "# ...y esa consulta queda en la auditoría, con su motivo" Enter
Type `sql 'SELECT seq, "actorRole", action, reason, outcome FROM audit_logs WHERE action = $$support.transactions.read$$ ORDER BY seq DESC LIMIT 1'` Enter
Sleep 3500ms
Type "clear" Enter
Type "# El administrador ve los correos enmascarados" Enter
Type `JQ='[.[] | {displayName, role, emailMasked}]' api admin GET "/admin/users?limit=4"` Enter
Sleep 3s
Type "# ...y no puede cambiar su propio rol (hace falta un segundo administrador)" Enter
Type `api admin PATCH /admin/users/$ADMIN/role '{"role":"USER"}'` Enter
Sleep 4s
