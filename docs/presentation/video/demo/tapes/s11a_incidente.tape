# Escena 11a — Actividad 7: incidente simulado, detección y contención automática, preservación de evidencia.
Output ../../assets/clips/s11a_incidente.mp4
Source "ajustes.tape"
Set FontSize 22
Hide
Type "source ../lib.sh && BACKEND=../../../../../apps/backend" Enter
Sleep 500ms
Show
Type "# Incidente simulado: alguien entra a la cuenta de marta con una contraseña filtrada" Enter
Type "node ../ataque.mjs" Enter
Sleep 24s
Type "clear" Enter
Type "# El sistema lo detectó solo, sobre el registro de auditoría (y avisó al buzón de seguridad)" Enter
Type `JQ='[.[] | select(.status == "OPEN") | {rule, severity, contencion: .details.automaticContainment}]' api admin GET /admin/security/alerts` Enter
Sleep 4s
Type "# Plan de respuesta, paso 1: preservar la evidencia ANTES de tocar nada" Enter
Type "npm --prefix $BACKEND run -s incident:snapshot -- --out $DEMO_DIR/evidencia 2>&1 | tail -3" Enter
Sleep 9s
