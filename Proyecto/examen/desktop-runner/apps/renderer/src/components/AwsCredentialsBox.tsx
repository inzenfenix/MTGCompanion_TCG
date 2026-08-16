import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { api } from '@/lib/api';
import type { AwsCredentials } from '@/lib/types';

// Academy Lab session tokens expire ~4h — a few minutes of margin before
// that so the warning shows up before the credentials actually stop
// working, not after.
const STALE_AFTER_MS = 3.5 * 60 * 60 * 1000;

function relativeAge(savedAt: number): string {
  const minutes = Math.round((Date.now() - savedAt) / 60000);
  if (minutes < 1) return 'recién ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `hace ${hours}h`;
}

/**
 * Credenciales AWS (ROADMAP.md workstream I) para correr Terraform local
 * contra la cuenta real. A diferencia de RoboflowApiKeyBox.tsx (key de
 * larga duración, click-para-desbloquear-y-editar), acá el form de
 * actualización queda SIEMPRE visible — el access key id se precarga, pero
 * secret/token quedan siempre en blanco para forzar un re-paste — porque
 * repegar cada ~4h (credenciales de AWS Academy Lab) es el flujo normal, no
 * una excepción. Ninguno de los tres campos se vuelve a mostrar en claro
 * después de guardar.
 */
export interface AwsCredentialsBoxProps {
  /** AwsTab.tsx lo usa para avisarle a TerraformActionCard (componente hermano, no un padre/hijo) que hay credenciales nuevas — sin esto, guardar acá no le llegaba a esa tarjeta hasta recargar la pestaña, cada uno cargaba `settings` una sola vez al montar y por separado. */
  onSaved?: () => void;
}

export function AwsCredentialsBox({ onSaved }: AwsCredentialsBoxProps) {
  const [saved, setSaved] = useState<AwsCredentials | null>(null);
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSaved(s.awsCredentials);
      if (s.awsCredentials) setAccessKeyId(s.awsCredentials.accessKeyId);
    });
  }, []);

  const stale = saved ? Date.now() - saved.savedAt > STALE_AFTER_MS : false;

  const handleSave = async () => {
    if (!accessKeyId.trim() || !secretAccessKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api.updateSettings({
        awsCredentials: {
          accessKeyId: accessKeyId.trim(),
          secretAccessKey: secretAccessKey.trim(),
          sessionToken: sessionToken.trim() || null,
          savedAt: Date.now(), // el server pisa esto con su propio reloj — ver settings.ts
        },
      });
      setSaved(next.awsCredentials);
      setSecretAccessKey('');
      setSessionToken('');
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Credenciales AWS</CardTitle>
          {saved && (
            <Badge variant={stale ? 'error' : 'success'}>
              {stale ? `guardadas ${relativeAge(saved.savedAt)} — pueden estar vencidas` : `guardadas ${relativeAge(saved.savedAt)}`}
            </Badge>
          )}
        </div>
        <CardDescription>
          Access key id, secret access key y session token (los tres, si esto apunta a una cuenta AWS Academy Learner
          Lab — "AWS Details" en la consola del lab). Se guardan solo en esta máquina
          (<code className="font-mono">~/.mtg-desktop-runner/settings.json</code>), nunca en el repo. Las credenciales
          de Academy Lab son temporales (~4h) — volvé a pegarlas acá cuando la pestaña de Terraform empiece a fallar
          con un error de autenticación.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div>
          <Label htmlFor="aws-access-key-id">Access key id</Label>
          <Input
            id="aws-access-key-id"
            placeholder="ASIA…"
            value={accessKeyId}
            onChange={(e) => setAccessKeyId(e.target.value)}
            className="mt-1 font-mono text-xs"
          />
        </div>
        <div>
          <Label htmlFor="aws-secret-access-key">Secret access key</Label>
          <Input
            id="aws-secret-access-key"
            type="password"
            placeholder="Pegá tu secret access key acá"
            value={secretAccessKey}
            onChange={(e) => setSecretAccessKey(e.target.value)}
            className="mt-1 font-mono text-xs"
          />
        </div>
        <div>
          <Label htmlFor="aws-session-token">Session token (Academy Lab: requerido)</Label>
          <Input
            id="aws-session-token"
            type="password"
            placeholder="Pegá tu session token acá — dejalo vacío para un IAM user normal"
            value={sessionToken}
            onChange={(e) => setSessionToken(e.target.value)}
            className="mt-1 font-mono text-xs"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" disabled={!accessKeyId.trim() || !secretAccessKey.trim() || saving} onClick={handleSave}>
          {saving ? 'Guardando…' : saved ? 'Actualizar' : 'Guardar'}
        </Button>
      </CardContent>
    </Card>
  );
}
