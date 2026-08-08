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

export function LogConsole({ lines, currentLine, status, lastActivityAt, className }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [idleSeconds, setIdleSeconds] = useState(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [lines.length, currentLine]);

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
      <ScrollArea className="h-56 rounded-md bg-slate-950 p-3 font-mono text-xs text-slate-100">
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
        <div ref={bottomRef} />
      </ScrollArea>
    </div>
  );
}
