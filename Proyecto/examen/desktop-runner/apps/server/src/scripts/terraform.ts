import * as path from 'path';
import { probeCommand, REPO_ROOT } from './tf-docker';
import { pathEnvWithToolBin } from './tool-install';
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
  // PATH con TOOL_BIN_DIR antepuesto: detecta un terraform/aws instalado por
  // el botón "Instalar" de esta misma app (tool-install.ts) aunque no haya
  // quedado en el PATH del sistema (el caso normal en Linux — en Windows
  // winget ya lo deja en el PATH del usuario por su cuenta, pero no hace
  // daño probar igual).
  const env = pathEnvWithToolBin();
  const [terraformInstalled, awsCliInstalled] = await Promise.all([
    probeCommand('terraform', ['version'], env),
    probeCommand('aws', ['--version'], env),
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

/**
 * Mismas credenciales que buildTerraformEnv() de arriba, pero con los
 * nombres de variable que el `aws` CLI mismo espera (`AWS_ACCESS_KEY_ID`/
 * etc.), no los `TF_VAR_*` que solo terraform entiende — `ssm.ts`/
 * scripts.service.ts's SSM helpers (terminal/túnel/Run Command) llaman a
 * `aws` directamente, nunca a `terraform`, así que necesitan esta versión,
 * no la otra. Confirmado en vivo que hacía falta: sin esto, `aws ssm ...`
 * fallaba con `NoCredentials` real (probado contra la cuenta real antes de
 * este fix).
 */
export function buildAwsCliEnv(creds: AwsCredentials | null): Record<string, string> {
  if (!creds) return {};
  const env: Record<string, string> = {
    AWS_ACCESS_KEY_ID: creds.accessKeyId,
    AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
  };
  if (creds.sessionToken) env.AWS_SESSION_TOKEN = creds.sessionToken;
  return env;
}
