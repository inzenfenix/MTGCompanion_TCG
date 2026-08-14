import { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { RunStatus } from '@/lib/types';

interface Props {
  lines: string[];
  currentLine?: string;
  status?: RunStatus;
  lastActivityAt?: number | null;
  className?: string;
}

// Cuánto margen (px) desde el fondo todavía cuenta como "está abajo" —
// alcanza para que reflow/redondeo de subpíxeles no lo saque del autoscroll
// por accidente.
const NEAR_BOTTOM_PX = 24;

export function LogConsole({ lines, currentLine, status, lastActivityAt, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wasNearBottomRef = useRef(true);
  const [idleSeconds, setIdleSeconds] = useState(0);

  // Autoscroll al fondo SOLO si el usuario ya estaba ahí — si se corrió para
  // arriba a leer algo, un script con mucho output (ej. 02_downloader.py con
  // varios workers en paralelo) no debería arrancarlo de vuelta al fondo en
  // cada línea nueva. Ojo: antes esto usaba scrollIntoView() sobre un div
  // sentinel al final de la lista, que busca el ancestro scrolleable más
  // cercano — con el contenedor scrolleado hasta el borde, terminaba
  // arrastrando también el scroll de LA PÁGINA entera hacia la consola en
  // cada línea nueva, dejando imposible bajar más allá de ella. Tocar
  // scrollTop directo sobre el contenedor de logs evita que el scroll salga
  // de ese elemento.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !wasNearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length, currentLine]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
  };

  // Aunque no llegue output nuevo, este contador confirma que el proceso sigue vivo
  // en vez de dejar la consola muda sin ninguna señal de actividad.
  useEffect(() => {
    if (status !== 'running') {
      setIdleSeconds(0);
      return;
    }
    const tick = () => setIdleSeconds(lastActivityAt ? Math.floor((Date.now() - lastActivityAt) / 1000) : 0);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, lastActivityAt]);

  const isRunning = status === 'running';
  const empty = lines.length === 0 && !currentLine;

  return (
    <div className={cn('space-y-1', className)}>
      {isRunning && (
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span>
            En vivo{idleSeconds > 0 ? ` · sin output nuevo hace ${idleSeconds}s (puede seguir procesando)` : ''}
          </span>
        </div>
      )}
      <ScrollArea
        ref={containerRef}
        onScroll={handleScroll}
        className="h-56 rounded-md bg-slate-950 p-3 font-mono text-xs text-slate-100"
      >
        {empty ? (
          <p className="text-slate-500">Sin output todavía…</p>
        ) : (
          <>
            {lines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {line}
              </div>
            ))}
            {currentLine && (
              <div className="whitespace-pre-wrap break-all text-slate-300">
                {currentLine}
                {isRunning && <span className="ml-0.5 animate-pulse">▌</span>}
              </div>
            )}
          </>
        )}
      </ScrollArea>
    </div>
  );
}
