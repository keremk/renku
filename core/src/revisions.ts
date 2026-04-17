import type { RevisionId } from './types.js';

const REVISION_ID_PATTERN = /^rev-(\d+)$/;
const revisionCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function compareRevisionIds(
  left: RevisionId,
  right: RevisionId
): number {
  const leftNumber = parseRevisionNumber(left);
  const rightNumber = parseRevisionNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber;
  }
  return revisionCollator.compare(left, right);
}

export function latestRevisionId(
  left: RevisionId | null | undefined,
  right: RevisionId | null | undefined
): RevisionId | null {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }
  return compareRevisionIds(left, right) >= 0 ? left : right;
}

export function nextRevisionId(current: RevisionId | null | undefined): RevisionId {
  if (!current) {
    return 'rev-0001';
  }
  const match = REVISION_ID_PATTERN.exec(current);
  const nextNumber = match ? parseInt(match[1], 10) + 1 : 1;
  const padded = String(nextNumber).padStart(4, '0');
  return `rev-${padded}`;
}

function parseRevisionNumber(revision: RevisionId): number | null {
  const match = REVISION_ID_PATTERN.exec(revision);
  return match ? Number.parseInt(match[1], 10) : null;
}
