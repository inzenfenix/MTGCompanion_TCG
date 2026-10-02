import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

/**
 * API key de Roboflow para `shared-download-roboflow` (datasets reales de
 * Stage 4, ver certamen_2/download_roboflow_condition_data.py). Se guarda en
 * la config local del runner (settings.ts, server) — nunca en el repo ni
 * hardcodeada en un script — y el server la inyecta como env var solo al
 * correr ese script puntual.
 */
export function RoboflowApiKeyBox() {
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => setSaved(s.roboflowApiKey ?? null));
  }, []);

  const handleSave = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const next = await api.updateSettings({ roboflowApiKey: draft.trim() });
      setSaved(next.roboflowApiKey ?? null);
      setEditing(false);
      setDraft('');
    } finally {
      setSaving(false);
    }
  };

  if (saved && !editing) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2">
            <Badge variant="success">API key configurada</Badge>
            <span className="font-mono text-xs text-muted-foreground">
              {saved.slice(0, 4)}…{saved.slice(-4)}
            </span>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Cambiar
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>API key de Roboflow</CardTitle>
        <CardDescription>
          Necesaria para descargar los datasets reales de daño/desgaste (Stage 4). Conseguila gratis en{' '}
          <code className="font-mono">roboflow.com</code> → Settings → API Key. Se guarda localmente en esta máquina,
          no en el repo.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <Input
          type="password"
          placeholder="Pegá tu API key acá"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        />
        <Button size="sm" disabled={!draft.trim() || saving} onClick={handleSave}>
          {saving ? 'Guardando…' : 'Guardar'}
        </Button>
        {editing && (
          <button
            onClick={() => {
              setEditing(false);
              setDraft('');
            }}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Cancelar
          </button>
        )}
      </CardContent>
    </Card>
  );
}
