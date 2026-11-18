# Escena 11c — Actividad 7: la cadena HMAC del registro detecta una edición a escondidas.
Output ../../assets/clips/s11c_cadena.mp4
Source "ajustes.tape"
Set FontSize 24
Hide
Type `source ../lib.sh && SEQ=$(psql -h localhost -U mtg mtg_companion -Atc "SELECT seq FROM audit_logs WHERE action = 'data.export' ORDER BY seq DESC LIMIT 1")` Enter
Sleep 500ms
Show
Type "# El registro de auditoría es de solo agregar: la base de datos rechaza editarlo" Enter
Type `sql 'UPDATE audit_logs SET outcome = $$DENIED$$ WHERE seq = 1'` Enter
Sleep 3s
Type "# Y cada fila está encadenada con un HMAC. Hoy la cadena está íntegra:" Enter
Type "api admin GET /admin/security/audit/verify" Enter
Sleep 3s
Type "clear" Enter
Type "# Alguien con acceso de dueño apaga el trigger y edita la fila de la exportación de marta..." Enter
Type "altera_auditoria $SEQ" Enter
Sleep 2s
Type "# ...la verificación marca exactamente dónde se rompió la cadena (y levanta una alerta)" Enter
Type "api admin GET /admin/security/audit/verify" Enter
Sleep 5s
