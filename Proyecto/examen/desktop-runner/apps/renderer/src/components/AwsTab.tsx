import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { AwsCredentialsBox } from './AwsCredentialsBox';
import { AwsServicesChecklist } from './AwsServicesChecklist';
import { TerraformActionCard } from './TerraformActionCard';
import { api } from '@/lib/api';

/**
 * Pestaña "Deploy" (ROADMAP.md workstream I) — infraestructura AWS real vía
 * Terraform, para que el APK deje de apuntar a localhost. Deliberadamente
 * no lleva un ScriptDef ni entra en TAB_BUCKETS/useRunAllStatus (App.tsx):
 * las acciones de Terraform no son scripts de certamen_1/2, tienen su
 * propio estado acá adentro.
 */
export function AwsTab() {
  const [outputs, setOutputs] = useState<Record<string, unknown> | null>(null);
  const [loadingOutputs, setLoadingOutputs] = useState(true);

  const loadOutputs = () => {
    setLoadingOutputs(true);
    api
      .terraformOutputs()
      .then(setOutputs)
      .finally(() => setLoadingOutputs(false));
  };

  useEffect(loadOutputs, []);

  return (
    <div className="space-y-4">
      <AwsCredentialsBox />
      <AwsServicesChecklist />
      <TerraformActionCard />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Outputs</CardTitle>
            <button
              onClick={loadOutputs}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Actualizar
            </button>
          </div>
          <CardDescription>
            Resultado de <code className="font-mono">terraform output</code> — <code className="font-mono">backend_url</code>{' '}
            es el valor a pegar en <code className="font-mono">trading-app-ionic/.env</code>'s{' '}
            <code className="font-mono">VITE_API_BASE_URL</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingOutputs && <p className="text-xs text-muted-foreground">Cargando…</p>}
          {!loadingOutputs && !outputs && (
            <p className="text-xs text-muted-foreground">
              Sin outputs todavía — corré <code className="font-mono">apply</code> arriba primero.
            </p>
          )}
          {outputs && (
            <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-xs">
              {JSON.stringify(outputs, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
