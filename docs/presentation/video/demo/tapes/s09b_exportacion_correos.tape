# Escena 9b — Actividades 5 y 6: la exportación (portabilidad) y las respuestas por escrito.
Output ../../assets/clips/s09b_exportacion_correos.mp4
Source "ajustes.tape"
Set FontSize 24
Hide
Type "source ../lib.sh && EXPORT=$(ls -t $DEMO_DIR/descargas/*.json | head -1)" Enter
Sleep 500ms
Show
Type "# La copia descargada: JSON estructurado y de uso común (portabilidad, art. 9)" Enter
Type "jq -c '{format, secciones: keys}' $EXPORT" Enter
Sleep 3s
Type "# Lo que NO incluye, y por qué: credenciales y datos de otros jugadores" Enter
Type "jq '[.notIncluded[] | .what]' $EXPORT" Enter
Sleep 4s
Type "clear" Enter
Type "# Cada solicitud se responde por escrito, y el cambio de correo se avisa a la dirección anterior" Enter
Type `correos dani 4 "correo de tu cuenta"` Enter
Sleep 7s
