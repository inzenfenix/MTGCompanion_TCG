/**
 * Estima cuántas cartas "sobreviven" los mismos filtros que 01_scraper.py
 * (ver `filtrar_y_limpiar` en ml/training/01_scraper.py) SIN
 * descargar el bulk dump completo de Scryfall (varios cientos de MB) —
 * usa `/cards/search`, que devuelve `total_cards` ya en la primera página
 * de resultados, sin tener que paginar el resto.
 *
 * Mirror de los filtros reales del script:
 *   - lang:en
 *   - set_type ∈ ALLOWED_SET_TYPES (expansion/core/masters/draft_innovation/commander)
 *   - layout ∉ {token, art_series, double_faced_token, emblem}
 * Única diferencia: acá no se filtra "con imagen disponible" (Scryfall no
 * expone eso como término de búsqueda) — en la práctica casi ninguna carta
 * oficial en estos set_types carece de imagen, así que el impacto es marginal.
 *
 * `total_cards` con unique=cards ≈ nombres de carta únicos que matchean
 * (≈ el "~30,000 nombres" que menciona el --help de 01_scraper.py).
 * `total_cards` con unique=prints ≈ impresiones totales matcheando, ANTES
 * del cap de MAX_PRINTINGS_POR_CARTA por nombre que aplica
 * `seleccionar_impresiones()`. El dataset final real (100% del slider) cae
 * entre esos dos números — se aproxima por `min(prints, names * cap)`,
 * ver comentario en getScraperCardCount().
 */

const SEARCH_URL = 'https://api.scryfall.com/cards/search';
// Mismo User-Agent que 01_scraper.py — Scryfall bloquea el genérico de requests/fetch.
const HEADERS = { 'User-Agent': 'MTG-Scanner-Academic/1.0', Accept: 'application/json' };
const QUERY =
  'lang:en (set_type:expansion or set_type:core or set_type:masters or set_type:draft_innovation or set_type:commander) ' +
  '-layout:token -layout:art_series -layout:double_faced_token -layout:emblem';
// Debe matchear MAX_PRINTINGS_POR_CARTA de 01_scraper.py — si cambia allá, cambiar acá.
const MAX_PRINTINGS_POR_CARTA = 3;

export interface ScraperCardCountResult {
  /** Nombres de carta únicos que matchean los filtros (≈ total_nombres del script). */
  namesTotal: number;
  /** Impresiones totales que matchean, antes del cap por nombre. */
  printsTotal: number;
  /** Estimación del tamaño final del dataset a "100%" — ver nota abajo. */
  estimatedTotal: number;
  maxPrintingsPerCard: number;
  query: string;
  /** Siempre true: es una estimación vía Scryfall search, no el conteo exacto que daría el bulk dump. */
  approximate: true;
  fetchedAt: string;
}

async function searchTotal(unique: 'cards' | 'prints'): Promise<number> {
  const params = new URLSearchParams({ q: QUERY, unique });
  const res = await fetch(`${SEARCH_URL}?${params.toString()}`, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Scryfall /cards/search (unique=${unique}) devolvió HTTP ${res.status}`);
  }
  const data = (await res.json()) as { total_cards?: number };
  if (typeof data.total_cards !== 'number') {
    throw new Error(`Respuesta de Scryfall sin "total_cards" (unique=${unique})`);
  }
  return data.total_cards;
}

let cached: Promise<ScraperCardCountResult> | null = null;

/**
 * Cachea el resultado una sola vez por proceso del server (mismo patrón que
 * detectGpu() en gpu-detect.ts) — el conteo real de Scryfall no cambia lo
 * suficiente entre renders de la UI como para justificar pegarle de nuevo
 * cada vez que se abre el formulario del scraper. Si el pedido falla, no se
 * cachea el error — el próximo GET reintenta desde cero.
 */
export function getScraperCardCount(): Promise<ScraperCardCountResult> {
  if (!cached) {
    cached = (async () => {
      const [namesTotal, printsTotal] = await Promise.all([searchTotal('cards'), searchTotal('prints')]);

      // Aproximación del tamaño final del dataset (post-dedupe a lo sumo
      // MAX_PRINTINGS_POR_CARTA impresiones por nombre, igual que
      // seleccionar_impresiones() en 01_scraper.py) sin bajar el dump
      // completo: cota superior barata de calcular. El cap real es
      // POR CARTA (cada nombre aporta min(sus_impresiones, 3)); acá se usa
      // un cap AGREGADO (names * 3) porque no tenemos la distribución de
      // impresiones por nombre — sobreestima un poco si hay cartas con
      // muchas más de 3 impresiones mezcladas con cartas de 1 sola
      // impresión, pero alcanza para escalar un slider (no hace falta
      // exactitud, el propio --max-cards ya re-muestrea al azar al correr).
      const estimatedTotal = Math.min(printsTotal, namesTotal * MAX_PRINTINGS_POR_CARTA);

      return {
        namesTotal,
        printsTotal,
        estimatedTotal,
        maxPrintingsPerCard: MAX_PRINTINGS_POR_CARTA,
        query: QUERY,
        approximate: true as const,
        fetchedAt: new Date().toISOString(),
      };
    })().catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}
