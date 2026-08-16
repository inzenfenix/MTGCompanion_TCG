import * as path from 'path';
import { probeCommand, REPO_ROOT } from './tf-docker';
import type { AwsCredentials } from './settings';

/**
 * Integra el stack de Terraform (Proyecto/examen/infra/terraform/,
 * ROADMAP.md workstream I) a la pestaña "Deploy" — mismo espíritu que
 * tf-docker.ts para el escape hatch de Docker: el server sabe correr/
 * streamear el comando, la UI da los botones. `infra/terraform/README.md`
 * documenta el flujo manual completo para quien prefiera la terminal.
 */

export const TERRAFORM_DIR = path.join(REPO_ROOT, 'Proyecto', 'examen', 'infra', 'terraform');

export type TerraformAction = 'init' | 'validate' | 'plan' | 'apply' | 'destroy';

export interface TerraformEligibility {
  terraformInstalled: boolean;
  awsCliInstalled: boolean;
  /** terraform es lo único estrictamente necesario para correr las acciones — aws cli es un nice-to-have (scripts/deploy-backend.sh sí lo necesita). */
  eligible: boolean;
}

export async function getTerraformEligibility(): Promise<TerraformEligibility> {
  const [terraformInstalled, awsCliInstalled] = await Promise.all([
    probeCommand('terraform', ['version']),
    probeCommand('aws', ['--version']),
  ]);
  return { terraformInstalled, awsCliInstalled, eligible: terraformInstalled };
}

/**
 * Dos rutas de credenciales separadas, no las mezcles (ver infra/PLAN.md):
 * esto es para Terraform CORRIENDO LOCALMENTE — se pasan como env vars al
 * proceso spawneado (mismo precedente que ROBOFLOW_API_KEY en
 * scripts.service.ts), nunca se escriben a terraform.tfvars ni a ningún
 * archivo. Lo que corre DENTRO de una instancia EC2 (llamadas S3 del
 * backend, fetch de Secrets Manager) usa en cambio LabInstanceProfile vía
 * la cadena de credenciales default del SDK — no pasa por acá.
 */
export function buildTerraformEnv(creds: AwsCredentials | null): Record<string, string> {
  if (!creds) return {};
  const env: Record<string, string> = {
    TF_VAR_aws_access_key_id: creds.accessKeyId,
    TF_VAR_aws_secret_access_key: creds.secretAccessKey,
  };
  if (creds.sessionToken) env.TF_VAR_aws_session_token = creds.sessionToken;
  return env;
}
