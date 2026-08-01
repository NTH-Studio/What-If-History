import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_RECEIPT_AGE_MS,
  RECEIPT_VERSION,
  evaluateVerificationReceipt,
  requiresEndToEnd,
} from './verification-evidence.mjs';

const now = Date.parse('2026-07-30T20:00:00.000Z');
const evidence = {
  root: 'C:\\DEV\\Projects\\What-If-History',
  head: 'abc123',
  fingerprint: 'fingerprint',
  changedFiles: ['apps/web/src/pages/GamePage.tsx'],
  dirty: true,
  requiresEndToEnd: true,
};
const validReceipt = {
  version: RECEIPT_VERSION,
  root: evidence.root,
  head: evidence.head,
  fingerprint: evidence.fingerprint,
  createdAt: new Date(now - 1_000).toISOString(),
  commands: ['git diff --check', 'npm run check', 'npm run test:e2e'],
};

test('accepts a clean worktree without a receipt', () => {
  assert.deepEqual(
    evaluateVerificationReceipt({ ...evidence, dirty: false }, { receipt: null, now }),
    { ok: true, reason: 'worktree propre' },
  );
});

test('blocks a dirty worktree without a receipt', () => {
  assert.equal(evaluateVerificationReceipt(evidence, { receipt: null, now }).ok, false);
});

test('blocks a receipt after the worktree changes', () => {
  const result = evaluateVerificationReceipt(
    { ...evidence, fingerprint: 'changed' },
    { receipt: validReceipt, now },
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /code a changé/);
});

test('blocks an expired receipt', () => {
  const result = evaluateVerificationReceipt(evidence, {
    receipt: {
      ...validReceipt,
      createdAt: new Date(now - MAX_RECEIPT_AGE_MS - 1).toISOString(),
    },
    now,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /expirée/);
});

test('requires Playwright evidence for application changes', () => {
  const result = evaluateVerificationReceipt(evidence, {
    receipt: {
      ...validReceipt,
      commands: ['git diff --check', 'npm run check'],
    },
    now,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Playwright/);
});

test('accepts a fresh receipt for the exact worktree', () => {
  assert.deepEqual(evaluateVerificationReceipt(evidence, { receipt: validReceipt, now }), {
    ok: true,
    reason: 'preuve fraîche correspondant exactement au worktree',
  });
});

test('detects files that require the complete browser suite', () => {
  assert.equal(requiresEndToEnd(['AGENTS.md', '.codex/hooks.json']), false);
  assert.equal(requiresEndToEnd(['apps/server/src/routes.ts']), true);
  assert.equal(requiresEndToEnd(['packages/contracts/src/index.ts']), true);
  assert.equal(requiresEndToEnd(['playwright.config.ts']), true);
});
