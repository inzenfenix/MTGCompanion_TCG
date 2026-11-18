# Escena 11b — Actividad 7: reconstrucción del incidente solo desde el registro (sin la API).
Output ../../assets/clips/s11b_reconstruccion.mp4
Source "ajustes.tape"
Set FontSize 17
Hide
Type "source ../lib.sh && BACKEND=../../../../../apps/backend && ALERTA=$(alerta_id account.takeover.sequence)" Enter
Sleep 800ms
Show
Type "# Paso 2: reconstruir el incidente solo desde el registro de auditoría, sin la API (por si está comprometida)" Enter
Type "npm --prefix $BACKEND run -s incident:timeline -- --alert $ALERTA --before 0.02 --after 0.01 2>&1 | grep -v '^$' | head -48" Enter
Sleep 14s
