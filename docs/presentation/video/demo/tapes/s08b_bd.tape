# Escena 8b — Actividad 5: la revocación tiene efecto real (BD + API).
Output ../../assets/clips/s08b_bd.mp4
Source "ajustes.tape"
Hide
Type "source ../lib.sh" Enter
Sleep 500ms
Show
Type "# ana retiró el consentimiento de ubicación: sus coordenadas se borraron en la misma operación" Enter
Type `sql 'SELECT "shareLocation", "lastLat", "lastLng" FROM user_settings WHERE "userId" = (SELECT id FROM users WHERE email = @ana)'` Enter
Sleep 3500ms
Type "# Si la app intenta enviar la ubicación de nuevo, la API la rechaza: no hay consentimiento vigente" Enter
Type `api ana PATCH /users/me/location '{"lat":-33.4255,"lng":-70.6111}'` Enter
Sleep 5s
