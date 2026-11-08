/**
 * What a blocking stops and what it doesn't (ROADMAP.md O16,
 * ACTIVIDAD_6.md §6.2) — shown to the player before and after asking for
 * it, and each line points at the code that enforces it.
 *
 * Art. 8 ter: "suspensión temporal de cualquier operación de tratamiento
 * … El ejercicio de este derecho no afectará el almacenamiento". Art. 11:
 * while unresolved "el responsable no podrá tratar los datos del titular que
 * forman parte del requerimiento".
 */
export const BLOCKING_COVERS = [
  {
    what: 'Publicación en el Bazar',
    how: 'Tus cartas no aparecen en las búsquedas (filtro en la consulta, PrismaCardRepository.searchListings).',
  },
  {
    what: 'Ofertas y compras nuevas sobre tus cartas',
    how: 'Se rechazan con 409 (OffersService.placeOffer, TransactionsService.create).',
  },
  {
    what: 'Ubicación',
    how: 'No se guarda una nueva aunque tengas el consentimiento vigente (UsersService.updateLocation → 403).',
  },
  {
    what: 'Correos opcionales',
    how: 'No se envía el aviso de nuevas ofertas aunque tengas el consentimiento vigente (PrivacyListeners).',
  },
  {
    what: 'Estadísticas de ventas',
    how: 'Tus transacciones no entran al informe (PrismaAdminRepository.paidSalesAggregates).',
  },
] as const;

export const BLOCKING_NOT_COVERED = [
  {
    what: 'Almacenamiento de tus datos',
    why: 'El art. 8 ter dice expresamente que el bloqueo no afecta el almacenamiento.',
  },
  {
    what: 'Tu propio acceso a la app y a tus datos',
    why: 'Lo necesitas para seguir tu solicitud, levantar el bloqueo o ejercer otros derechos.',
  },
  {
    what: 'Compras y ventas ya acordadas (pendientes o subastas ya ganadas) y sus comprobantes',
    why: 'Son contratos ya formados con otra persona y obligaciones tributarias (art. 13 b y c); el bloqueo no puede usarse para incumplirlos.',
  },
  {
    what: 'Registro de auditoría',
    why: 'Es seudonimizado y prueba, entre otras cosas, que tu bloqueo se respetó (art. 8 a, defensa ante reclamaciones).',
  },
] as const;
