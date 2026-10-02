import * as path from 'path';
import { probeCommand, REPO_ROOT } from './tf-docker';
import { pathEnvWithToolBin } from './tool-install';
import type { AwsCredentials } from './settings';

/**
 * Integra el stack de Terraform (infra/terraform/,
 * ROADMAP.md workstream I) a la pestaña "Deploy" — mismo espíritu que
 * tf-docker.ts para el escape hatch de Docker: el server sabe correr/
 * streamear el comando, la UI da los botones. `infra/terraform/README.md`
 * documenta el flujo manual completo para quien prefiera la terminal.
 */

export const TERRAFORM_DIR = path.join(REPO_ROOT, 'infra', 'terraform');

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
 * Credenciales AWS para cualquier proceso spawneado localmente — `aws` CLI
 * directo (S3 sync, SSM terminal/túnel/Run Command, ver ssm.ts/
 * scripts.service.ts) y, desde 19 ago, `terraform` mismo también (ver
 * providers.tf: el provider ya no lee `var.aws_access_key_id`, usa la
 * cadena de credenciales default de AWS, que son justamente estos mismos
 * nombres de env var). Antes había un `buildTerraformEnv()` separado que
 * exportaba las mismas credenciales bajo nombres `TF_VAR_*` en vez de
 * `AWS_*` — eliminado (19 ago) junto con las variables Terraform que
 * consumía: ese doble camino era exactamente lo que dejaba a Terraform
 * expuesto al footgun de `*.tfvars` (un `terraform.tfvars` con
 * credenciales viejas hardcodeadas silenciosamente pisa un `TF_VAR_*` de
 * env — precedence de Terraform, no un bug de este proyecto — mientras que
 * nada podía pisar un `AWS_ACCESS_KEY_ID` de env porque no había ninguna
 * variable Terraform correspondiente a la que un `.tfvars` le ganara).
 * Encontrado y solo *documentado* como riesgo conocido el 16 ago (ver
 * README.md/ROADMAP.md), efectivamente disparado en la práctica el 19 ago
 * pese a haber repegado credenciales frescas en la pestaña Deploy — este
 * cambio lo elimina de raíz en vez de seguir pidiendo mantenerlo
 * sincronizado a mano. Lo que corre DENTRO de una instancia EC2 (llamadas
 * S3 del backend, fetch de Secrets Manager) sigue sin pasar por acá — usa
 * LabInstanceProfile vía la cadena de credenciales default del SDK.
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
