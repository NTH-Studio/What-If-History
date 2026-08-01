import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const RECEIPT_VERSION = 1;
export const MAX_RECEIPT_AGE_MS = 6 * 60 * 60 * 1000;

function runGit(root, args, options = {}) {
  return execFileSync('git', ['-c', 'core.safecrlf=false', '-C', root, ...args], {
    encoding: options.encoding,
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.stdio,
  });
}

function splitNullTerminated(value) {
  return value.toString('utf8').split('\0').filter(Boolean);
}

function normalizeRelativePath(value) {
  return value.replaceAll('\\', '/');
}

function samePath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

export function resolveGitRoot(cwd) {
  return runGit(path.resolve(cwd), ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
}

export function verificationReceiptPath(root) {
  const override = process.env.CODEX_VERIFICATION_RECEIPT_PATH;
  return override
    ? path.resolve(override)
    : path.join(root, '.codex', '.verification', 'last-success.json');
}

export function requiresEndToEnd(changedFiles) {
  const runtimeRoots = ['apps/', 'packages/', 'tests/e2e/'];
  const runtimeFiles = new Set([
    'package.json',
    'package-lock.json',
    'playwright.config.ts',
    'tsconfig.base.json',
    'vitest.config.ts',
    'eslint.config.js',
  ]);

  return changedFiles.some(
    (file) => runtimeFiles.has(file) || runtimeRoots.some((root) => file.startsWith(root)),
  );
}

export function collectWorktreeEvidence(cwd) {
  const root = resolveGitRoot(cwd);
  const head = runGit(root, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const diff = runGit(root, ['diff', '--binary', '--no-ext-diff', 'HEAD', '--'], {
    encoding: 'buffer',
  });
  const trackedFiles = splitNullTerminated(
    runGit(root, ['diff', '--name-only', '-z', 'HEAD', '--'], { encoding: 'buffer' }),
  );
  const untrackedFiles = splitNullTerminated(
    runGit(root, ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'buffer' }),
  ).sort();

  const hash = crypto.createHash('sha256');
  hash.update(`what-if-history-verification-v${RECEIPT_VERSION}\0`);
  hash.update(head);
  hash.update('\0tracked-diff\0');
  hash.update(diff);

  for (const relativeFile of untrackedFiles) {
    const normalizedFile = normalizeRelativePath(relativeFile);
    hash.update('\0untracked\0');
    hash.update(normalizedFile);
    hash.update('\0');
    const absoluteFile = path.join(root, relativeFile);
    if (fs.existsSync(absoluteFile) && fs.statSync(absoluteFile).isFile()) {
      hash.update(fs.readFileSync(absoluteFile));
    }
  }

  const changedFiles = [
    ...new Set([...trackedFiles, ...untrackedFiles].map(normalizeRelativePath)),
  ].sort();

  return {
    root,
    head,
    fingerprint: hash.digest('hex'),
    changedFiles,
    dirty: diff.length > 0 || untrackedFiles.length > 0,
    requiresEndToEnd: requiresEndToEnd(changedFiles),
  };
}

export function readVerificationReceipt(root) {
  const receiptPath = verificationReceiptPath(root);
  if (!fs.existsSync(receiptPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch {
    return null;
  }
}

export function evaluateVerificationReceipt(evidence, options = {}) {
  if (!evidence.dirty) return { ok: true, reason: 'worktree propre' };

  const receipt = options.receipt ?? readVerificationReceipt(evidence.root);
  if (!receipt)
    return { ok: false, reason: 'aucune preuve de validation n’existe pour ce worktree' };
  if (receipt.version !== RECEIPT_VERSION) {
    return { ok: false, reason: 'le format de la preuve de validation est obsolète' };
  }
  if (!samePath(receipt.root, evidence.root)) {
    return { ok: false, reason: 'la preuve appartient à un autre dépôt' };
  }
  if (receipt.head !== evidence.head || receipt.fingerprint !== evidence.fingerprint) {
    return { ok: false, reason: 'le code a changé depuis la dernière validation réussie' };
  }

  const createdAt = Date.parse(receipt.createdAt);
  const now = options.now ?? Date.now();
  if (
    !Number.isFinite(createdAt) ||
    now - createdAt > MAX_RECEIPT_AGE_MS ||
    createdAt > now + 60_000
  ) {
    return {
      ok: false,
      reason: 'la preuve de validation est absente, expirée ou datée dans le futur',
    };
  }

  const commands = Array.isArray(receipt.commands) ? receipt.commands : [];
  if (!commands.includes('npm run check')) {
    return { ok: false, reason: '`npm run check` n’est pas attesté par la preuve' };
  }
  if (evidence.requiresEndToEnd && !commands.includes('npm run test:e2e')) {
    return {
      ok: false,
      reason: 'la suite Playwright complète n’est pas attestée pour les changements applicatifs',
    };
  }

  return { ok: true, reason: 'preuve fraîche correspondant exactement au worktree' };
}

export function writeVerificationReceipt(evidence, commands) {
  const receiptPath = verificationReceiptPath(evidence.root);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const receipt = {
    version: RECEIPT_VERSION,
    root: evidence.root,
    head: evidence.head,
    fingerprint: evidence.fingerprint,
    changedFiles: evidence.changedFiles,
    createdAt: new Date().toISOString(),
    commands,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return receiptPath;
}
