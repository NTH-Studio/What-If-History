import { execFileSync } from 'node:child_process';
import { collectWorktreeEvidence, writeVerificationReceipt } from './verification-evidence.mjs';

const initialEvidence = collectWorktreeEvidence(process.cwd());
const commands = [];

function run(executable, args, label) {
  console.log(`\n[verification] ${label}`);
  execFileSync(executable, args, {
    cwd: initialEvidence.root,
    env: process.env,
    stdio: 'inherit',
  });
  commands.push(label);
}

function runNpm(args, label) {
  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    run(process.execPath, [npmCli, ...args], label);
    return;
  }
  run('npm', args, label);
}

try {
  run('git', ['-c', 'core.safecrlf=false', 'diff', '--check'], 'git diff --check');
  runNpm(['run', 'check'], 'npm run check');

  if (initialEvidence.requiresEndToEnd) {
    runNpm(['run', 'test:e2e'], 'npm run test:e2e');
  } else {
    console.log('\n[verification] Playwright non requis : aucun fichier applicatif n’a changé.');
  }

  const finalEvidence = collectWorktreeEvidence(initialEvidence.root);
  if (
    finalEvidence.head !== initialEvidence.head ||
    finalEvidence.fingerprint !== initialEvidence.fingerprint
  ) {
    throw new Error(
      'Le worktree a changé pendant la validation. Relance `npm run verify:task` sur l’état final.',
    );
  }

  const receiptPath = writeVerificationReceipt(finalEvidence, commands);
  console.log(`\n[verification] Porte réussie. Preuve enregistrée dans ${receiptPath}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[verification] ÉCHEC : ${message}`);
  process.exit(1);
}
