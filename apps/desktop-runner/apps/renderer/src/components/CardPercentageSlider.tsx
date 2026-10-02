import { useEffect, useRef, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/input';
import { api } from '@/lib/api';
import type { ArgDef } from '@/lib/types';

const nf = new Intl.NumberFormat('es-CL');

/**
 * Slider 1%–100% para "--max-cards" de 01_scraper.py (shared-scraper).
 *
 * `values.max_cards` (el valor que de verdad se manda al script) sigue
 * siendo el número crudo de siempre — 0 significa "sin cap" (--max-cards 0),
 * cualquier otro entero es el cap real. Este componente solo traduce entre
 * ese número crudo y el % que ve el usuario, usando el total real del
 * catálogo (GET /scripts/shared-scraper/card-count, cacheado en el server).
 *
 * 100% nunca se traduce a un número fijo: se manda 0 tal cual (el propio
 * scraper decide cuánto es "todo" el día que corre), justamente porque el
 * catálogo de Scryfall puede haber cambiado entre que se abrió esta pantalla
 * y que se apretó "Correr".
 */
export function CardPercentageSlider({
  arg,
  value,
  onChange,
  disabled,
}: {
  arg: ArgDef;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
  disabled?: boolean;
}) {
  const [total, setTotal] = useState<number | null>(null);
  const [totalError, setTotalError] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    api
      .scraperCardCount()
      .then((r) => setTotal(r.estimatedTotal))
      .catch((e) => setTotalError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Hidrata el % inicial una sola vez, apenas se conoce el total real, a
  // partir del valor crudo que ya trae el form (el default de
  // scripts.config.ts, ej. 5000) — así el slider arranca reflejando el
  // default real del script en vez de siempre en 100%.
  useEffect(() => {
    if (hydrated.current || total === null) return;
    hydrated.current = true;
    const raw = typeof value === 'number' ? value : Number(value);
    if (!raw || raw <= 0) {
      setPercent(100);
    } else {
      setPercent(Math.min(100, Math.max(1, Math.round((raw / total) * 100))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  const handleSlide = (pct: number) => {
    setPercent(pct);
    if (pct >= 100) {
      onChange(arg.name, 0); // 0 = sin cap — nunca se "hornea" un número para el 100%
      return;
    }
    const raw = total ? Math.max(1, Math.round((total * pct) / 100)) : pct;
    onChange(arg.name, raw);
  };

  const shownPercent = percent ?? 100;
  const raw = typeof value === 'number' ? value : 0;
  const totalKnown = total !== null;

  return (
    <div>
      <Label htmlFor={arg.name}>{arg.label}</Label>
      <div className="mt-1 flex items-center gap-3">
        <Slider
          id={arg.name}
          min={1}
          max={100}
          value={shownPercent}
          onValueChange={handleSlide}
          disabled={disabled || !totalKnown}
          className="flex-1"
        />
        <span className="w-12 shrink-0 text-right text-sm font-medium tabular-nums">{shownPercent}%</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {totalError
          ? `No se pudo consultar el catálogo de Scryfall (${totalError}) — se puede correr igual, pero sin la estimación de cantidad.`
          : !totalKnown
            ? 'Consultando el tamaño real del catálogo en Scryfall…'
            : shownPercent >= 100
              ? `100% = todo lo que permiten los filtros del scraper, sin cap artificial (~${nf.format(total!)} cartas estimadas hoy — el número real puede variar levemente al correr, y el scraper igual deduplica a lo sumo 3 impresiones por carta).`
              : `≈ ${nf.format(raw)} cartas de un total estimado de ~${nf.format(total!)} que permiten los filtros del scraper.`}
      </p>
      {arg.help && <p className="mt-1 text-[11px] text-muted-foreground">{arg.help}</p>}
    </div>
  );
}
