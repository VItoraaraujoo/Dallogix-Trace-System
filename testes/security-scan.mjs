import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';

const raiz = path.resolve(import.meta.dirname, '..');
const script = path.join(raiz, 'scripts', 'security_scan.sh');

function executar(env = {}) {
  return spawnSync('bash', [script], {
    cwd: raiz,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('scanner de segurança passa quando o git grep não encontra ocorrências', () => {
  const resultado = executar();
  assert.equal(resultado.status, 0, resultado.stderr || resultado.stdout);
  assert.match(resultado.stdout, /nenhuma credencial privada/);
});

test('scanner de segurança falha quando o git grep não consegue executar', async () => {
  const diretorioTemporario = await mkdtemp(path.join(os.tmpdir(), 'trace-security-scan-'));
  const gitReal = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  assert.ok(gitReal, 'git precisa estar disponível para o teste');

  const gitFalso = path.join(diretorioTemporario, 'git-falso');
  await writeFile(
    gitFalso,
    `#!/usr/bin/env bash\nif [[ "\${1:-}" == "grep" ]]; then\n  echo "falha simulada do git grep" >&2\n  exit 2\nfi\nexec ${gitReal} "$@"\n`,
    'utf8',
  );
  await chmod(gitFalso, 0o755);

  const resultado = executar({ TRACE_SECURITY_SCAN_GIT: gitFalso });
  assert.equal(resultado.status, 2, resultado.stderr || resultado.stdout);
  assert.match(resultado.stderr, /Falha ao executar a varredura de chaves privadas/);
  assert.match(resultado.stderr, /status 2/);
});
