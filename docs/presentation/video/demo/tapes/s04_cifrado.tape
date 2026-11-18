# Escena 4 — Actividad 2: hash, cifrado AES-256-GCM, alteración rechazada, llaves fuera del repo.
Output ../../assets/clips/s04_cifrado.mp4
Source "ajustes.tape"

Hide
Type "cd ../../../../../apps/backend && source ../../docs/presentation/video/demo/lib.sh" Enter
Sleep 500ms
Show

Type "# 1) Contraseña: hash bcrypt con sal (costo 12), nunca texto plano" Enter
Type `sql 'SELECT email, "passwordHash" FROM users WHERE email = @marta'` Enter
Sleep 3s
Type "# 2) Ubicación: cifrada con AES-256-GCM, con formato v1:<iv>:<tag>:<texto cifrado>" Enter
Type `sql 'SELECT "lastLat" FROM user_settings WHERE "userId" = (SELECT id FROM users WHERE email = @marta)'` Enter
Sleep 3s
Type "clear" Enter
Type "# 3) eva tiene 2FA; su secreto TOTP también está cifrado. Inicio de sesión normal:" Enter
Type "login_2fa eva" Enter
Sleep 3s
Type "# Altero UN solo carácter del secreto cifrado, directo en la base de datos..." Enter
Type "altera_cifrado eva" Enter
Sleep 2500ms
Type "login_2fa eva" Enter
Sleep 3s
Type "# El backend falla cerrado: GCM detecta la alteración (el log no muestra el valor)" Enter
Type `grep -o "FieldEncryptionError: .*" $LOG | tail -1` Enter
Sleep 4s
Type "clear" Enter
Type "# 4) Ningún secreto en las más de 200 commits del repositorio" Enter
Type "gitleaks git --no-banner --redact ../.. 2>&1 | tail -2" Enter
Sleep 4s
Type "# 5) Sin la llave de cifrado, el backend se niega a arrancar" Enter
Type `FIELD_ENCRYPTION_KEY= node dist/main.js 2>&1 | grep -m1 -o "FieldEncryptionError: .*"` Enter
Sleep 6s

Hide
Type "restaura_cifrado eva" Enter
Sleep 500ms
