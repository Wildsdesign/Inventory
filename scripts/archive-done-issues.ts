#!/usr/bin/env tsx
/**
 * archive-done-issues.ts
 *
 * Archives Linear issues that meet ALL of:
 *   1. State = "completed" (Done)
 *   2. completedAt ≥ HOURS_BUFFER hours ago  (default 18h — gives operator a walk window)
 *   3. Has at least one CC audit comment (body contains "autonomous session")
 *   4. NOT labelled "keep-active"
 *
 * Usage:
 *   LINEAR_API_KEY=lin_api_... npx tsx scripts/archive-done-issues.ts
 *   -- or --
 *   npm run archive:done
 *
 * Optional flags:
 *   --dry-run     Print what would be archived without actually archiving
 *   --hours N     Override the walk-window buffer (default 18)
 *   --team KEY    Linear team key (default "WIL")
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_HOURS_BUFFER = 18;
const DEFAULT_TEAM_KEY = 'WIL';
const AUDIT_COMMENT_SIGNAL = 'autonomous session'; // marker written by CC in every audit comment
const KEEP_ACTIVE_LABEL = 'keep-active';
const GQL_ENDPOINT = 'https://api.linear.app/graphql';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const HOURS_BUFFER = (() => {
  const idx = args.indexOf('--hours');
  return idx >= 0 ? Number(args[idx + 1]) || DEFAULT_HOURS_BUFFER : DEFAULT_HOURS_BUFFER;
})();
const TEAM_KEY = (() => {
  const idx = args.indexOf('--team');
  return idx >= 0 ? args[idx + 1] || DEFAULT_TEAM_KEY : DEFAULT_TEAM_KEY;
})();

// ── Env ───────────────────────────────────────────────────────────────────────

function loadDotenv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = value;
  }
}

loadDotenv();

const API_KEY = process.env.LINEAR_API_KEY;
if (!API_KEY) {
  console.error('❌  LINEAR_API_KEY not set.\n   Export it or add LINEAR_API_KEY=lin_api_... to .env');
  process.exit(1);
}

// ── GraphQL client ─────────────────────────────────────────────────────────────

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(GQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`GraphQL: ${json.errors.map((e) => e.message).join(', ')}`);
  }
  if (!json.data) throw new Error('No data returned from GraphQL');
  return json.data;
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  completedAt: string | null;
  labels: { nodes: Array<{ name: string }> };
  comments: { nodes: Array<{ body: string; createdAt: string }> };
}

// ── Queries / Mutations ────────────────────────────────────────────────────────

async function getDoneIssues(): Promise<LinearIssue[]> {
  const data = await gql<{ issues: { nodes: LinearIssue[] } }>(`
    query DoneIssues($teamKey: String!) {
      issues(
        filter: {
          state: { type: { eq: "completed" } }
          team: { key: { eq: $teamKey } }
        }
        first: 250
        orderBy: completedAt
      ) {
        nodes {
          id
          identifier
          title
          completedAt
          labels { nodes { name } }
          comments(first: 30) {
            nodes { body createdAt }
          }
        }
      }
    }
  `, { teamKey: TEAM_KEY });

  return data.issues.nodes;
}

async function archiveIssue(id: string): Promise<boolean> {
  const data = await gql<{ issueArchive: { success: boolean } }>(`
    mutation ArchiveIssue($id: String!) {
      issueArchive(id: $id) { success }
    }
  `, { id });
  return data.issueArchive.success;
}

// ── Eligibility check ──────────────────────────────────────────────────────────

function checkEligibility(
  issue: LinearIssue
): { eligible: true } | { eligible: false; reason: string } {
  if (!issue.completedAt) {
    return { eligible: false, reason: 'missing completedAt' };
  }

  const ageHours = (Date.now() - new Date(issue.completedAt).getTime()) / (1000 * 60 * 60);
  if (ageHours < HOURS_BUFFER) {
    return {
      eligible: false,
      reason: `${ageHours.toFixed(1)}h old — within ${HOURS_BUFFER}h walk window`,
    };
  }

  const labelNames = issue.labels.nodes.map((l) => l.name.toLowerCase());
  if (labelNames.includes(KEEP_ACTIVE_LABEL)) {
    return { eligible: false, reason: 'has "keep-active" label' };
  }

  const hasAuditComment = issue.comments.nodes.some((c) =>
    c.body.toLowerCase().includes(AUDIT_COMMENT_SIGNAL.toLowerCase())
  );
  if (!hasAuditComment) {
    return { eligible: false, reason: 'no CC audit comment (missing "autonomous session" marker)' };
  }

  return { eligible: true };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const runLabel = DRY_RUN ? ' [DRY RUN]' : '';
  console.log(`🗄️  Linear Done-issue archive pass${runLabel}`);
  console.log(`   Team: ${TEAM_KEY} | Walk window: ${HOURS_BUFFER}h | Signal: "${AUDIT_COMMENT_SIGNAL}"\n`);

  const issues = await getDoneIssues();
  console.log(`Fetched ${issues.length} Done issue(s).\n`);

  const archived: LinearIssue[] = [];
  const skippedTooNew: LinearIssue[] = [];
  const skippedNoComment: LinearIssue[] = [];
  const skippedKeepActive: LinearIssue[] = [];
  const skippedOther: Array<{ issue: LinearIssue; reason: string }> = [];

  for (const issue of issues) {
    const result = checkEligibility(issue);
    if (!result.eligible) {
      const r = (result as { eligible: false; reason: string }).reason;
      if (r.includes('walk window')) skippedTooNew.push(issue);
      else if (r.includes('audit comment')) skippedNoComment.push(issue);
      else if (r.includes('keep-active')) skippedKeepActive.push(issue);
      else skippedOther.push({ issue, reason: r });
      continue;
    }

    if (DRY_RUN) {
      console.log(`  🔍 Would archive: ${issue.identifier} — ${issue.title}`);
      archived.push(issue);
      continue;
    }

    try {
      const success = await archiveIssue(issue.id);
      if (success) {
        console.log(`  ✅ Archived ${issue.identifier}: ${issue.title}`);
        archived.push(issue);
      } else {
        console.warn(`  ⚠️  Archive returned false for ${issue.identifier}`);
        skippedOther.push({ issue, reason: 'mutation returned false' });
      }
    } catch (err) {
      console.error(`  ❌ Failed ${issue.identifier}:`, err);
      skippedOther.push({ issue, reason: String(err) });
    }
  }

  // Summary
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Archived${DRY_RUN ? ' (dry run)' : ''}:  ${archived.length}`);
  console.log(`Skipped:`);
  if (skippedTooNew.length)
    console.log(`  ${skippedTooNew.length} within ${HOURS_BUFFER}h walk window (will archive next session)`);
  if (skippedNoComment.length)
    console.log(`  ${skippedNoComment.length} no CC audit comment — left active`);
  if (skippedKeepActive.length)
    console.log(`  ${skippedKeepActive.length} keep-active labelled — left active`);
  if (skippedOther.length)
    console.log(`  ${skippedOther.length} other reasons`);

  if (archived.length > 0) {
    console.log(`\nArchived${DRY_RUN ? ' (would be)' : ''}:`);
    for (const i of archived) console.log(`  • ${i.identifier}: ${i.title}`);
  }

  if (!DRY_RUN && archived.length === 0 && skippedTooNew.length > 0) {
    console.log(`\nℹ️  All Done issues are within the ${HOURS_BUFFER}h walk window.`);
    console.log(`   Run again at next session start to archive them.`);
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
