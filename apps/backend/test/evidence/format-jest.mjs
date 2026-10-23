// Turns `jest --json` output into the per-case evidence format used in
// docs/security/evidencia/actividad4 and actividad5 ("[OK] case name").
//
//   npx jest --json --outputFile=<tmp>.json
//   node test/evidence/format-jest.mjs <tmp>.json "<header command>" > <evidence>.txt
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [file, command = 'npx jest'] = process.argv.slice(2);
const r = JSON.parse(readFileSync(file, 'utf8'));
const okSuites = r.testResults.filter((s) => s.status === 'passed').length;
const lines = [
  `# ${command}`,
  `# Resultado por caso: [OK] pasó · [FALLA] falló · [OMITIDA] omitida.  ` +
    `${r.numPassedTests} pasaron, ${r.numFailedTests} fallaron, ${r.numTotalTests} en total; ` +
    `${okSuites}/${r.testResults.length} suites OK.`,
  `# Fecha: ${new Date(r.startTime).toISOString()}`,
];
for (const suite of r.testResults) {
  const cases = suite.assertionResults;
  const passed = cases.filter((c) => c.status === 'passed').length;
  lines.push('', `## ${basename(suite.name)}  (${passed}/${cases.length})`);
  for (const c of cases) {
    const tag = c.status === 'passed' ? '[OK]    ' : c.status === 'failed' ? '[FALLA] ' : '[OMITIDA]';
    const name = [...c.ancestorTitles.slice(1), c.title].join(' › ');
    lines.push(`  ${tag} ${name}`);
  }
}
console.log(lines.join('\n'));
