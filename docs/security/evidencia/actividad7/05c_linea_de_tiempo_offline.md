# Reconstrucción del incidente — alerta 9f517036-51f3-4205-8945-6289265ec83f

- Regla: `account.takeover.sequence` (HIGH), estado CONFIRMED, levantada 2026-11-08T02:11:52.562Z
- Sujeto (seudónimo): `u_55c28db922c767ad (marta)`
- Ventana: 2026-11-08T01:11:52.562Z → 2026-11-08T03:11:52.562Z
- Cadena de integridad: OK (88 filas, seq 1–90)
- Eventos: 27 (7 denegados o fallidos), del 2026-11-08T02:11:49.325Z al 2026-11-08T02:11:52.781Z
- Categorías de datos personales tocadas: colección, credenciales, geolocalización, identificación, preferencias, transacciones
- Otras cuentas afectadas: `u_a57538b47fcd (pedro)` (2: access.profile.read, access.transaction.read)

## Por fase

| Fase | Eventos |
|---|---|
| Acceso a la cuenta | 7 |
| Reconocimiento (intentos denegados) | 5 |
| Acceso a datos personales | 5 |
| Modificación | 3 |
| Exfiltración o destrucción | 1 |
| Detección | 2 |
| Contención | 4 |

## Línea de tiempo

| seq | hora (UTC) | fase | actor | rol | acción | afectado | recurso | motivo | resultado |
|---|---|---|---|---|---|---|---|---|---|
| 57 | 02:11:49.325 | Modificación | u_55c28db922c7 (marta) | USER | account.register | — | user |  | ALLOWED |
| 58 | 02:11:49.502 | Acceso a la cuenta | u_55c28db922c7 (marta) | USER | auth.login | — |  |  | ALLOWED |
| 63 | 02:11:50.205 | Modificación | u_55c28db922c7 (marta) | USER | market.card.create | — | card 7f4c3c8e |  | ALLOWED |
| 65 | 02:11:51.608 | Acceso a la cuenta | u_55c28db922c7 (marta) | USER | auth.login | — |  | bad-password | FAILED |
| 66 | 02:11:51.783 | Acceso a la cuenta | u_55c28db922c7 (marta) | USER | auth.login | — |  | bad-password | FAILED |
| 67 | 02:11:51.958 | Acceso a la cuenta | u_55c28db922c7 (marta) | USER | auth.login | — |  |  | ALLOWED |
| 68 | 02:11:51.961 | Acceso a datos personales | u_55c28db922c7 (marta) | USER | access.transaction.list | — | transaction | n=1 | ALLOWED |
| 69 | 02:11:51.963 | Acceso a datos personales | u_55c28db922c7 (marta) | USER | access.transaction.read | u_a57538b47fcd (pedro) | transaction 0ee0e01b |  | ALLOWED |
| 70 | 02:11:51.965 | Acceso a datos personales | u_55c28db922c7 (marta) | USER | access.profile.read | u_a57538b47fcd (pedro) | user |  | ALLOWED |
| 71 | 02:11:51.967 | Reconocimiento (intentos denegados) | u_55c28db922c7 (marta) | USER | access.transaction.read | — | transaction 432266a0 | forbidden | DENIED |
| 72 | 02:11:51.969 | Reconocimiento (intentos denegados) | u_55c28db922c7 (marta) | USER | access.receipt.read | — | transaction 432266a0 | forbidden | DENIED |
| 73 | 02:11:51.972 | Reconocimiento (intentos denegados) | u_55c28db922c7 (marta) | USER | access.transaction.read | — | transaction 16ce3bc8 | not-found | DENIED |
| 74 | 02:11:51.974 | Reconocimiento (intentos denegados) | u_55c28db922c7 (marta) | USER | access.transaction.read | — | transaction aef9bb71 | not-found | DENIED |
| 75 | 02:11:51.976 | Reconocimiento (intentos denegados) | u_55c28db922c7 (marta) | USER | access.transaction.read | — | transaction eff44b1d | not-found | DENIED |
| 76 | 02:11:51.977 | Detección | system | — | security.alert.raised | u_55c28db922c7 (marta) | security-alert 21608edf | transactions.enumeration (MEDIUM) | ALLOWED |
| 77 | 02:11:52.193 | Acceso a la cuenta | u_55c28db922c7 (marta) | USER | auth.step-up | — |  | password | ALLOWED |
| 78 | 02:11:52.202 | Modificación | u_55c28db922c7 (marta) | USER | data.rectify | u_55c28db922c7 (marta) | data-rights-request 021c3546 | email | ALLOWED |
| 79 | 02:11:52.377 | Acceso a la cuenta | u_55c28db922c7 (marta) | USER | auth.login | — |  |  | ALLOWED |
| 80 | 02:11:52.552 | Acceso a la cuenta | u_55c28db922c7 (marta) | USER | auth.step-up | — |  | password | ALLOWED |
| 81 | 02:11:52.560 | Exfiltración o destrucción | u_55c28db922c7 (marta) | USER | data.export | u_55c28db922c7 (marta) | data-rights-request 74d5b6d2 |  | ALLOWED |
| 82 | 02:11:52.563 | Detección | system | — | security.alert.raised | u_55c28db922c7 (marta) | security-alert 9f517036 | account.takeover.sequence (HIGH) | ALLOWED |
| 83 | 02:11:52.607 | Contención | system | — | security.containment.revoke-sessions | u_55c28db922c7 (marta) | security-alert 9f517036 |  | ALLOWED |
| 84 | 02:11:52.613 | Contención | u_3909f316b564 (admin) | ADMIN | security.alert.update | — | security-alert 9f517036 | OPEN -> INVESTIGATING: Cambio de correo + exportación; la ti | ALLOWED |
| 86 | 02:11:52.770 | Acceso a datos personales | u_3909f316b564 (admin) | ADMIN | admin.incident.timeline | — | security-alert 9f517036 | 23 rows, chain ok | ALLOWED |
| 87 | 02:11:52.774 | Acceso a datos personales | u_3909f316b564 (admin) | ADMIN | admin.incident.timeline | — | security-alert 9f517036 | 24 rows, chain ok | ALLOWED |
| 88 | 02:11:52.777 | Contención | u_3909f316b564 (admin) | ADMIN | security.alert.update | — | security-alert 9f517036 | INVESTIGATING -> CONFIRMED: Toma de cuenta confirmada: expor | ALLOWED |
| 89 | 02:11:52.781 | Contención | u_3909f316b564 (admin) | ADMIN | security.containment.disable | u_55c28db922c7 (marta) | user | INC-1: cuenta tomada; se deshabilita mientras se devuelve a  | ALLOWED |
