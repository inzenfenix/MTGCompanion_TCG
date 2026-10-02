import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Checkbox, Label } from '@/components/ui/input';
import { api } from '@/lib/api';
import type { AwsServicesChecklist as AwsServicesChecklistType } from '@/lib/types';

// EC2/S3/Secrets Manager son estructurales — este stack de Terraform
// siempre los usa (S3 solo si useMinio=false), se muestran pre-tildados,
// deshabilitados. SNS/SQS/DynamoDB/Cognito son puramente informativos: la
// cuenta lab los tiene disponibles pero esta app no los integra hoy (sin
// cola async, sin modelo de datos DynamoDB, auth propio con JWT) — decisión
// de infra/PLAN.md, no algo a implementar acá. useMinio es el único
// checkbox con efecto real en infra (espeja terraform.tfvars, no lo aplica
// solo).
const STRUCTURAL: { key: 'ec2' | 's3' | 'secretsManager'; label: string; hint: string }[] = [
  { key: 'ec2', label: 'EC2', hint: '4 instancias: postgres, mailhog, minio (opcional), backend.' },
  { key: 's3', label: 'S3', hint: 'Fotos de cartas — activo salvo que "usar MinIO" esté tildado abajo.' },
  { key: 'secretsManager', label: 'Secrets Manager', hint: 'postgres_password, jwt_secret, credenciales de MercadoPago.' },
];

const INFORMATIONAL: { key: 'sns' | 'sqs' | 'dynamodb' | 'cognito'; label: string }[] = [
  { key: 'sns', label: 'SNS' },
  { key: 'sqs', label: 'SQS' },
  { key: 'dynamodb', label: 'DynamoDB' },
  { key: 'cognito', label: 'Cognito' },
];

export function AwsServicesChecklist() {
  const [checklist, setChecklist] = useState<AwsServicesChecklistType | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => setChecklist(s.awsServicesChecklist));
  }, []);

  const update = async (patch: Partial<AwsServicesChecklistType>) => {
    if (!checklist) return;
    const next = { ...checklist, ...patch };
    setChecklist(next); // optimista — es solo un checkbox de documentación/preferencia
    setSaving(true);
    try {
      await api.updateSettings({ awsServicesChecklist: next });
    } finally {
      setSaving(false);
    }
  };

  if (!checklist) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Servicios AWS</CardTitle>
        <CardDescription>
          Qué corre como servicio administrado vs. self-hosted en una EC2. Los primeros tres son estructurales de este
          stack; los últimos cuatro (disponibles en la cuenta lab) son solo documentales — esta app no los integra
          hoy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {STRUCTURAL.map(({ key, label, hint }) => (
            <div key={key} className="flex items-start gap-2">
              <Checkbox id={`aws-svc-${key}`} checked={checklist[key]} disabled className="mt-0.5" />
              <Label htmlFor={`aws-svc-${key}`} className="font-normal">
                <span className="font-medium text-foreground">{label}</span>{' '}
                <span className="text-xs text-muted-foreground">— {hint}</span>
              </Label>
            </div>
          ))}
        </div>

        <div className="rounded-md border border-border bg-muted/40 p-2">
          <div className="flex items-start gap-2">
            <Checkbox
              id="aws-svc-use-minio"
              checked={checklist.useMinio}
              disabled={saving}
              onChange={(e) => update({ useMinio: e.target.checked, s3: !e.target.checked })}
              className="mt-0.5"
            />
            <Label htmlFor="aws-svc-use-minio" className="font-normal">
              <span className="font-medium text-foreground">Usar MinIO en vez de S3 real</span>{' '}
              <span className="text-xs text-muted-foreground">
                — cambia <code className="font-mono">use_minio</code> en <code className="font-mono">terraform.tfvars</code>{' '}
                pero NO aplica solo — tenés que correr <code className="font-mono">terraform apply</code> de nuevo desde la
                pestaña Terraform.
              </span>
            </Label>
          </div>
        </div>

        <div className="space-y-2 border-t border-border pt-2">
          <p className="text-xs text-muted-foreground">Disponibles en la cuenta, sin integración en esta app (solo documental):</p>
          {INFORMATIONAL.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <Checkbox
                id={`aws-svc-${key}`}
                checked={checklist[key]}
                disabled={saving}
                onChange={(e) => update({ [key]: e.target.checked } as Partial<AwsServicesChecklistType>)}
              />
              <Label htmlFor={`aws-svc-${key}`} className="font-normal">
                {label}
              </Label>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
