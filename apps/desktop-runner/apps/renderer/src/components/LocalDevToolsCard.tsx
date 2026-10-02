import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

const STORAGE_KEY = 'mtg-local-dev-backend-url';
const DEFAULT_URL = 'http://localhost:3000';

const normalizeUrl = (url: string) => url.trim().replace(/\/$/, '').toLowerCase();

export interface LocalDevToolsCardProps {
  /** `terraform output`'s `backend_url` (AwsTab.tsx already loads it for OutputsCard) — powers the "Producción (AWS)"
   * quick-select button below and, more importantly, the warning banner: without this the card has no way to know
   * whether whatever's typed in the input happens to be the real deployed instance. `null`/`undefined` while there's
   * no `apply` run yet — the button stays disabled, no banner. */
  productionBackendUrl?: string | null;
}

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
 * NODE_ENV !== 'production') — this UI has no way to *prevent* someone
 * typing a production URL in, on purpose, matching the honest framing this
 * row's own ROADMAP note already settled on. L6 add-on: since pointing this
 * at production is a legitimate way to test that the guard actually 403s
 * there (not just in the e2e suite), there's now a one-click "Producción
 * (AWS)" shortcut instead of having to copy the URL by hand — paired with a
 * persistent warning banner (any time the target resolves to that URL,
 * button or manual typing alike) and a second-click confirm on the reset
 * button itself, same UX pattern as TerraformActionCard's apply/destroy.
 */
export function LocalDevToolsCard({ productionBackendUrl }: LocalDevToolsCardProps = {}) {
  const [backendUrl, setBackendUrl] = useState(() => localStorage.getItem(STORAGE_KEY) ?? DEFAULT_URL);
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingProdConfirm, setPendingProdConfirm] = useState(false);

  const updateBackendUrl = (value: string) => {
    setBackendUrl(value);
    setPendingProdConfirm(false);
    localStorage.setItem(STORAGE_KEY, value);
  };

  const isProdTarget = !!productionBackendUrl && normalizeUrl(backendUrl) === normalizeUrl(productionBackendUrl);

  const runReset = async () => {
    setResetting(true);
    setResult(null);
    setError(null);
    setPendingProdConfirm(false);
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

  const handleResetClick = () => {
    if (isProdTarget && !pendingProdConfirm) {
      setPendingProdConfirm(true);
      return;
    }
    runReset();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dev tools — reset de cooldown</CardTitle>
        <CardDescription>
          Por defecto prueba el backend local (<code className="font-mono">npm run start:dev</code> en{' '}
          <code className="font-mono">backend/</code>). El botón "Producción (AWS)" de abajo apunta a propósito a la
          instancia real desplegada, para poder probar ahí también — el endpoint debería devolver 403 salvo que el
          backend corra con algo distinto de <code className="font-mono">NODE_ENV=production</code> (que es como se
          despliega siempre, ver <code className="font-mono">deploy-backend.sh</code>), así que un 403 ahí es lo
          esperado, no un error.
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
          <div className="mt-1 flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => updateBackendUrl(DEFAULT_URL)}>
              Local
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!productionBackendUrl}
              title={
                productionBackendUrl ? undefined : 'Sin backend_url todavía — corré "apply" en Terraform primero (arriba en esta pestaña).'
              }
              onClick={() => productionBackendUrl && updateBackendUrl(productionBackendUrl)}
            >
              Producción (AWS)
            </Button>
          </div>
        </div>

        {isProdTarget && (
          <Alert variant="warning">
            <AlertTitle>Apuntando a producción</AlertTitle>
            <AlertDescription>
              Esta URL es la instancia AWS real desplegada ({backendUrl}), no un backend local. El guard del servidor
              debería rechazar esto con 403 — si en cambio borra cupones, es un bug del guard (revisalo), no algo
              esperado.
            </AlertDescription>
          </Alert>
        )}

        {pendingProdConfirm && (
          <Alert variant="destructive">
            <AlertTitle>Confirmar contra producción</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                Vas a mandar un DELETE real a {backendUrl}. Debería volver 403 (DevOnlyGuard), pero si por algún motivo
                no está bloqueando ahí (p. ej. <code className="font-mono">NODE_ENV</code> mal seteado en el
                deploy), esto borra los cupones de cuentas reales. ¿Confirmás igual?
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={runReset}>
                  Sí, mandar igual
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPendingProdConfirm(false)}>
                  Cancelar
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Button
          size="sm"
          variant={isProdTarget ? 'destructive' : 'outline'}
          disabled={resetting || !backendUrl}
          onClick={handleResetClick}
        >
          {resetting ? 'Reiniciando…' : 'Reiniciar cooldown de la ruleta (borra todos los cupones)'}
        </Button>
        {result && <p className="text-xs text-muted-foreground">{result}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
