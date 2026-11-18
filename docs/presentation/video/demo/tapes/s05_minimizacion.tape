# Escena 5 — Actividad 4: el registro solo acepta lo necesario.
Output ../../assets/clips/s05_minimizacion.mp4
Source "ajustes.tape"
Hide
Type "source ../lib.sh" Enter
Sleep 500ms
Show
Type "# El registro acepta exactamente 4 datos: correo, contraseña, alias y declaración 18+" Enter
Type "# Si se envía algo más (un teléfono), se rechaza: no hay forma de guardarlo por error" Enter
Type `api - POST /users/register '{"email":"nuevo@example.com","password":"Demo-Registro-2026","displayName":"Nuevo","adultConfirmed":true,"phone":"+56 9 1111 2222"}'` Enter
Sleep 3s
Type "# El alias tampoco puede usarse para publicar un contacto" Enter
Type `api - POST /users/register '{"email":"nuevo@example.com","password":"Demo-Registro-2026","displayName":"escríbeme a nuevo@gmail.com","adultConfirmed":true}'` Enter
Sleep 3s
Type "# Sin la declaración de mayoría de edad no hay cuenta (no pedimos fecha de nacimiento)" Enter
Type `api - POST /users/register '{"email":"nuevo@example.com","password":"Demo-Registro-2026","displayName":"Nuevo"}'` Enter
Sleep 4s
