# Escena 10 — Actividad 6: canal público, oposición (art. 8) y bloqueo (art. 8 ter).
Output ../../assets/clips/s10_oposicion_bloqueo.mp4
Source "ajustes.tape"
Set FontSize 24
Hide
Type "source ../lib.sh && CARTA_MATEO=$(_state .cards.mateoVenta)" Enter
Sleep 500ms
Show
Type "# Canal público, sin sesión: la respuesta es idéntica exista o no la cuenta (no sirve para averiguar quién está registrado)" Enter
Type `JQ='{message}' api - POST /data-rights/public-requests '{"email":"pedro@example.com","type":"ACCESS"}'` Enter
Sleep 2500ms
Type `JQ='{message}' api - POST /data-rights/public-requests '{"email":"no-existe@example.com","type":"ACCESS"}'` Enter
Sleep 4s
Type "clear" Enter
Type "# Oposición (art. 8): la celda del reporte de ventas tiene hoy 6 ventas" Enter
Type `JQ='.cells[] | {month, sales}' api admin GET /admin/reports/sales` Enter
Sleep 2s
Type "# valentina se opone a que sus ventas cuenten en las estadísticas (interés legítimo): se acoge" Enter
Type `JQ='.request | {type, scope, outcome, efecto: .details.effect}' api valentina POST /data-rights/requests '{"type":"OBJECTION","purpose":"SALES_STATISTICS","statement":"No quiero que mis ventas se usen en estadisticas."}'` Enter
Sleep 3s
Type `JQ='.cells[] | {month, sales}' api admin GET /admin/reports/sales` Enter
Sleep 3500ms
Type "clear" Enter
Type "# Oposición al monitoreo de seguridad: se deniega, con fundamento (art. 8 a: motivos legítimos imperiosos)" Enter
Type `JQ='.request | {scope, outcome, fundamento: .message}' api valentina POST /data-rights/requests '{"type":"OBJECTION","purpose":"SECURITY_MONITORING","statement":"No quiero que se registre mi actividad."}'` Enter
Sleep 6s
Type "clear" Enter
Type "# Bloqueo (art. 8 ter): mateo suspende el tratamiento de sus datos, sin borrar nada" Enter
Type `JQ='.request | {type, outcome, plazo: .dueAt}' api mateo POST /data-rights/requests '{"type":"BLOCKING","blocking":{"basis":"ALTERNATIVE_TO_ERASURE"},"statement":"Prefiero pausar mis datos en vez de borrar la cuenta."}'` Enter
Sleep 3s
Type "# Su carta desaparece del Bazar, y nadie puede ofertar por ella" Enter
Type `JQ='[.[] | {title, vendedor: .ownerDisplayName}]' api pedro GET "/cards?q=Birds"` Enter
Sleep 2500ms
Type `api pedro POST /cards/$CARTA_MATEO/offers '{"amount":12}'` Enter
Sleep 3500ms
Type "clear" Enter
Type "# mateo levanta el bloqueo y todo vuelve a funcionar" Enter
Type `JQ='{kind, status, liftReason}' api mateo DELETE /data-rights/controls/blocking` Enter
Sleep 2s
Type `JQ='{amount}' api pedro POST /cards/$CARTA_MATEO/offers '{"amount":12}'` Enter
Sleep 4s
