import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

const STORAGE_KEY = 'mtg-local-dev-backend-url';
const DEFAULT_URL = 'http://localhost:3000';

/**
 * ROADMAP.md L6 — dev-only reset for the spin-the-wheel coupon system, so
 * L4's wheel can be spun repeatedly during local testing without waiting
 * out the real 24h cooldown. Deliberately separate from OutputsCard's
 * Terraform-outputs buttons above (those run through SSM against a
 * *deployed* EC2 instance — see AwsTab.tsx's own header comment for why
 * that's a different mechanism): this card talks directly, over plain
 * HTTP, to whatever backend URL is typed below — a locally-running `npm
 * run start:dev` NestJS server by default, never the deployed one unless
 * someone deliberately points it there.
 *
 * The real safety net is server-side (backend's DevOnlyGuard, 403s unless
 * NODE_ENV !== 'production') — this UI has no way to prevent someone
 * typing a production URL in, on purpose, matching the honest framing this
 * row's own ROADMAP note already settled on.
 */
export function LocalDevToolsCard() {
  const [backendUrl, setBackendUrl] = useState(() => localStorage.getItem(STORAGE_KEY) ?? DEFAULT_URL);
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateBackendUrl = (value: string) => {
    setBackendUrl(value);
    localStorage.setItem(STORAGE_KEY, value);
  };

  const resetSpinCooldowns = async () => {
    setResetting(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch(`${backendUrl.replace(/\/$/, '')}/coupons/dev-reset-all`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error((body && typeof body === 'object' && 'message' in body ? String(body.message) : null) ?? res.statusText);
      }
      const body = (await res.json()) as { deleted: number };
      setResult(`${body.deleted} cupón(es) borrados — cooldown de giro libre para todas las cuentas.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dev tools — backend local</CardTitle>
        <CardDescription>
          Solo para probar el backend local (<code className="font-mono">npm run start:dev</code> en{' '}
          <code className="font-mono">backend/</code>), no la instancia AWS desplegada — el endpoint 403 solo si el
          backend corre con <code className="font-mono">NODE_ENV=production</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor="local-dev-backend-url">Backend URL</Label>
          <Input
            id="local-dev-backend-url"
            placeholder={DEFAULT_URL}
            value={backendUrl}
            onChange={(e) => updateBackendUrl(e.target.value)}
            className="mt-1 font-mono text-xs"
          />
        </div>
        <Button size="sm" variant="outline" disabled={resetting || !backendUrl} onClick={resetSpinCooldowns}>
          {resetting ? 'Reiniciando…' : 'Reiniciar cooldown de la ruleta (borra todos los cupones)'}
        </Button>
        {result && <p className="text-xs text-muted-foreground">{result}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
