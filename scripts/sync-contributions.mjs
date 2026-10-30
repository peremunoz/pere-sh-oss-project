#!/usr/bin/env node
/**
 * Automated script to synchronize pull requests authored by the user across external repositories
 * using the GitHub GraphQL API.
 *
 * Supported features:
 * - Queries all PRs authored by the configured username on external repositories (-user:<username>).
 * - Filters by creation date (defaults to >= 2026-10-01 to capture current OSS agentic initiative only).
 * - Extracts every possible PR status: merged, open, draft, closed.
 * - Extracts the primary repository language as the contribution language.
 * - Captures additions, deletions, and changed files diff metrics.
 * - Paginates automatically up to all available PRs.
 * - Merges and updates src/data/contributions.json idempotently with case-insensitive deduplication.
 *
 * Usage:
 *   node scripts/sync-contributions.mjs
 *   node scripts/sync-contributions.mjs --since 2026-10-01
 *   node scripts/sync-contributions.mjs --username peremunoz
 *   node scripts/sync-contributions.mjs --dry-run
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = resolve(__dirname, '../src/data/contributions.json');

const GRAPHQL_QUERY = `
query FetchExternalPRs($searchQuery: String!, $cursor: String) {
  search(query: $searchQuery, type: ISSUE, first: 100, after: $cursor) {
    issueCount
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      ... on PullRequest {
        number
        title
        url
        state
        isDraft
        createdAt
        updatedAt
        mergedAt
        closedAt
        additions
        deletions
        changedFiles
        repository {
          nameWithOwner
          url
          isPrivate
          isFork
          primaryLanguage {
            name
          }
        }
      }
    }
  }
}
`;

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

function resolveToken(cliToken) {
  if (cliToken) return cliToken;
  if (process.env.CONTRIBUTIONS_TOKEN) return process.env.CONTRIBUTIONS_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  // Try retrieving via gh CLI if authenticated
  try {
    const token = execSync('gh auth token', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (token) return token;
  } catch {
    // Ignore error if gh is not installed or unauthenticated
  }

  return null;
}

function normalizeStatus(pr) {
  if (pr.state === 'MERGED') {
    return 'merged';
  }
  if (pr.isDraft) {
    return 'draft';
  }
  if (pr.state === 'OPEN') {
    return 'open';
  }
  if (pr.state === 'CLOSED') {
    return 'closed';
  }
  return String(pr.state || 'open').toLowerCase();
}

function toDateString(iso) {
  return iso ? String(iso).split('T')[0] : null;
}

function transformPullRequest(pr) {
  if (!pr || !pr.repository || !pr.repository.nameWithOwner) {
    return null;
  }

  const repo = pr.repository.nameWithOwner;
  const prNumber = Number(pr.number);
  const id = `${repo.replace(/[^a-zA-Z0-9]/g, '-')}-${prNumber}`.toLowerCase();
  const repoUrl = pr.repository.url || `https://github.com/${repo}`;
  const language = pr.repository.primaryLanguage?.name || 'Code';
  const status = normalizeStatus(pr);

  return {
    id,
    repo,
    repoUrl,
    prNumber,
    prTitle: String(pr.title || '').trim(),
    prUrl: String(pr.url || '').trim(),
    status,
    createdAt: toDateString(pr.createdAt),
    mergedAt: toDateString(pr.mergedAt),
    closedAt: toDateString(pr.closedAt),
    updatedAt: toDateString(pr.updatedAt),
    language,
    stats: {
      additions: Number(pr.additions || 0),
      deletions: Number(pr.deletions || 0),
      filesChanged: Number(pr.changedFiles || 0)
    }
  };
}

async function executeGraphQL(query, variables, token) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'contributions-sync-script'
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub GraphQL API responded with status ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(`GraphQL query errors: ${JSON.stringify(payload.errors, null, 2)}`);
  }

  return payload.data;
}

async function fetchAllPullRequests(username, sinceDate, token) {
  const searchQuery = `is:pr author:${username} -user:${username} created:>=${sinceDate}`;
  console.log(`[INFO] Querying GitHub GraphQL Search: "${searchQuery}"`);

  let cursor = null;
  let hasNextPage = true;
  const allNodes = [];
  let page = 1;

  while (hasNextPage) {
    console.log(`[INFO] Fetching page ${page}...`);
    const data = await executeGraphQL(GRAPHQL_QUERY, { searchQuery, cursor }, token);
    const searchResult = data?.search;

    if (!searchResult) {
      console.warn('[WARN] No search results returned from GraphQL');
      break;
    }

    const nodes = (searchResult.nodes || []).filter(Boolean);
    allNodes.push(...nodes);

    hasNextPage = searchResult.pageInfo?.hasNextPage;
    cursor = searchResult.pageInfo?.endCursor;
    page++;

    if (!cursor) break;
  }

  console.log(`[INFO] Total PR nodes fetched from GitHub: ${allNodes.length}`);
  return allNodes;
}

function sortContributions(items) {
  const getTime = (c) => {
    const dateStr = c.mergedAt || c.closedAt || c.updatedAt || c.createdAt;
    return dateStr ? new Date(dateStr).getTime() : 0;
  };
  return [...items].sort((a, b) => getTime(b) - getTime(a));
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  const username = cliArgs.username || process.env.GITHUB_USERNAME || 'peremunoz';
  const sinceDate = cliArgs.since || process.env.CONTRIBUTIONS_SINCE || '2026-10-01';
  const isDryRun = Boolean(cliArgs['dry-run']);

  console.log(`====================================================`);
  console.log(`GitHub OSS Contributions GraphQL Sync`);
  console.log(`Target Author: @${username} (external repositories only)`);
  console.log(`Since Date: >= ${sinceDate}`);
  console.log(`Dry Run: ${isDryRun}`);
  console.log(`====================================================`);

  const token = resolveToken(cliArgs.token);
  if (!token) {
    console.error(`[ERROR] No GitHub token found.`);
    console.error(`Please provide a token via GH_TOKEN, GITHUB_TOKEN, CONTRIBUTIONS_TOKEN, or --token <token>.`);
    console.error(`In local development, you can also log in via 'gh auth login'.`);
    process.exit(1);
  }

  // Read existing contributions and filter out anything older than sinceDate
  let existingContributions = [];
  try {
    const rawExisting = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
    existingContributions = rawExisting.filter((c) => {
      const date = c.createdAt || c.mergedAt || c.closedAt || c.updatedAt;
      return date && date >= sinceDate;
    });
    console.log(`[INFO] Loaded ${existingContributions.length} active contributions (>= ${sinceDate}) from ${DATA_FILE}`);
  } catch (err) {
    console.warn(`[WARN] Could not read existing data file (${err.message}). Starting fresh.`);
  }

  const rawPRs = await fetchAllPullRequests(username, sinceDate, token);

  // Transform and filter
  const fetchedContributions = [];
  for (const raw of rawPRs) {
    // Exclude own repositories (defense in depth)
    const repo = raw.repository?.nameWithOwner;
    if (repo && repo.toLowerCase().startsWith(`${username.toLowerCase()}/`)) {
      continue;
    }
    // Exclude private repos
    if (raw.repository?.isPrivate) {
      continue;
    }
    // Double-check creation date >= sinceDate
    const createdDate = raw.createdAt ? String(raw.createdAt).split('T')[0] : null;
    if (createdDate && createdDate < sinceDate) {
      continue;
    }

    const transformed = transformPullRequest(raw);
    if (transformed) {
      fetchedContributions.push(transformed);
    }
  }

  console.log(`[INFO] Transformed ${fetchedContributions.length} external pull requests created since ${sinceDate}.`);

  // Merge map: normalize keys by lowercase repo + prNumber to avoid case-sensitivity duplicates
  const getDedupKey = (item) => `${(item.repo || '').toLowerCase()}#${item.prNumber}`;
  const contributionMap = new Map();

  for (const item of existingContributions) {
    if (item.repo && item.prNumber) {
      contributionMap.set(getDedupKey(item), item);
    }
  }

  // Update / insert fetched entries
  let addedCount = 0;
  let updatedCount = 0;

  for (const fetched of fetchedContributions) {
    const key = getDedupKey(fetched);
    if (contributionMap.has(key)) {
      const existing = contributionMap.get(key);
      contributionMap.set(key, {
        ...existing,
        ...fetched,
        id: fetched.id, // Ensure canonical lowercase id
        stats: {
          ...existing.stats,
          ...fetched.stats
        }
      });
      updatedCount++;
    } else {
      contributionMap.set(key, fetched);
      addedCount++;
    }
  }

  const mergedList = sortContributions(Array.from(contributionMap.values()));

  const statusCounts = mergedList.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});

  console.log(`\n--- Sync Summary ---`);
  console.log(`Total Contributions Recorded: ${mergedList.length}`);
  console.log(`New Added: ${addedCount}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Breakdown by Status:`, statusCounts);

  if (isDryRun) {
    console.log(`[INFO] Dry run enabled. No changes written to ${DATA_FILE}.`);
    return;
  }

  writeFileSync(DATA_FILE, JSON.stringify(mergedList, null, 2) + '\n', 'utf-8');
  console.log(`[SUCCESS] Wrote ${mergedList.length} contributions to ${DATA_FILE}`);
}

main().catch((err) => {
  console.error(`[FATAL] Sync failed:`, err);
  process.exit(1);
});
