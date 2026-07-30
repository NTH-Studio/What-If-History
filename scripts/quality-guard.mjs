import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const failures = [];
const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
  'runtime',
  'saves',
  'debug',
]);

function walk(relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  if (!fs.existsSync(absoluteDirectory)) return [];
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : walk(relative);
    }
    return [relative.replaceAll('\\', '/')];
  });
}

const projectFiles = [
  ...walk('apps'),
  ...walk('packages'),
  ...walk('scripts'),
  ...walk('docs'),
  ...walk('data'),
  'README.md',
  'package.json',
  'package-lock.json',
  '.env.example',
  'server.ps1',
  'server.bat',
].filter((file) => fs.existsSync(path.join(root, file)));

const sourceFiles = projectFiles.filter((file) => /\.(?:js|mjs|ts|tsx|html)$/.test(file));
const forbidden = [
  {
    name: 'native JavaScript dialog',
    pattern: /\b(?:window\.|globalThis\.|self\.)?(?:alert|confirm|prompt)\s*\(/,
  },
  { name: 'raw React HTML', pattern: /\bdangerouslySetInnerHTML\b/ },
];

for (const relative of sourceFiles) {
  const content = fs.readFileSync(path.join(root, relative), 'utf8');
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) failures.push(`${relative}: ${rule.name}`);
  }
}

let isGitRepository = false;
try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: 'ignore' });
  isGitRepository = true;
} catch {
  // This local installation can be used without source control.
}

if (isGitRepository) {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  for (const file of tracked) {
    if (
      file.includes('/node_modules/') ||
      file === 'backend/.env' ||
      file === 'data/llm_settings.json' ||
      file.startsWith('data/saves/') ||
      file.startsWith('data/debug/')
    ) {
      failures.push(`${file}: runtime artifact is tracked`);
    }
  }
}

// eslint-disable-next-line no-irregular-whitespace
const mojibake =
  /(?:\u00c3\u0192.|\u00c3\u201a.|\u00c3\u00e2\u201a\u00ac|\u00c3\u00e2\u20ac\u017e|\u00c3\u00e2\u0153|\u00c3\u00e2\u20ac\u00a0|\u00c3\u00e2\u20ac\u009d|\u00c3\u00e2\u20ac\u00a2|\u00c3\u00af\u00c2\u00b8|\u00c3\u00b0\u00c5\u00b8|\ufffd)/;
const retiredTerms = [
  `Pa${'x Historia'}`,
  `Local-Pa${'x-Historia'}`,
  `Pa${'xHistoria'}`,
  `pa${'x-historia'}`,
  `@pa${'x/'}`,
  `x-pa${'x-'}`,
  `pa${'x-client-id'}`,
  `pa${'x-language'}`,
  `pa${'x-theme'}`,
  `pa${'x-event-playback'}`,
  `pa${'xhistoria.co'}`,
].map((term) => term.toLowerCase());

for (const relative of projectFiles) {
  const absolute = path.join(root, relative);
  if (fs.statSync(absolute).size > 5_000_000) continue;
  const content = fs.readFileSync(absolute, 'utf8');
  if (/^(?:apps|packages|data|README)/.test(relative) && mojibake.test(content)) {
    failures.push(`${relative}: probable mojibake`);
  }
  const lowerContent = content.toLowerCase();
  if (retiredTerms.some((term) => lowerContent.includes(term))) {
    failures.push(`${relative}: retired product identity`);
  }
  if (relative.endsWith('.json')) {
    try {
      JSON.parse(content);
    } catch {
      failures.push(`${relative}: invalid JSON`);
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Quality guard passed (${sourceFiles.length} source files checked).`);
