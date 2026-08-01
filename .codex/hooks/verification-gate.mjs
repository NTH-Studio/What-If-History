import {
  collectWorktreeEvidence,
  evaluateVerificationReceipt,
} from '../../scripts/verification-evidence.mjs';

async function readStandardInput() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input.trim() ? JSON.parse(input) : {};
}

function continuation(reason) {
  return {
    decision: 'block',
    reason:
      `Validation obligatoire non satisfaite : ${reason}\n` +
      'Exécute `npm run verify:task`, corrige toute erreur, puis vérifie manuellement le rendu réel si l’interface a changé. ' +
      'Ne conclus pas la tâche tant que la porte ne reconnaît pas la nouvelle preuve.',
  };
}

try {
  const input = await readStandardInput();
  const evidence = collectWorktreeEvidence(input.cwd ?? process.cwd());
  const evaluation = evaluateVerificationReceipt(evidence);

  if (evaluation.ok) {
    process.stdout.write(JSON.stringify({ continue: true }));
  } else {
    process.stdout.write(JSON.stringify(continuation(evaluation.reason)));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(
    JSON.stringify(
      continuation(
        `le hook n'a pas pu contrôler le dépôt (${message}). Cette erreur doit être corrigée`,
      ),
    ),
  );
}
