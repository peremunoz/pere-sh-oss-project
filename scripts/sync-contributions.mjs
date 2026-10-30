#!/usr/bin/env node
/**
 * Automated script to synchronize pull requests authored by the user across external repositories
 * using the GitHub GraphQL API.
 *
 * Supported features:
 * - Queries all PRs authored by the configured username on external repositories (-user:<username>).
 * - Extracts every possible PR status: merged, open, draft, closed.
 * - Extracts the primary repository language as the contribution language.
 * - Captures additions, deletions, and changed files diff metrics.
 * - Paginates automatically up to all available PRs.
 * - Merges and updates src/data/contributions.json idempotently.
 *
 * Usage:
 *   node scripts/sync-contributions.mjs
 *   node scripts/sync-contributions.mjs --username peremunoz
 *   node scripts/sync-contributions.mjs --dry-run
 *   node scripts/sync-contributions.mjs --mock
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

function getMockPRs(username) {
  return [
    {
      number: 1926,
      title: 'fix(group-chat): pass full-access permissionMode for writable participant spawns',
      url: 'https://github.com/RunMaestro/Maestro/pull/1926',
      state: 'MERGED',
      isDraft: false,
      createdAt: '2026-10-27T10:00:00Z',
      mergedAt: '2026-10-28T14:22:10Z',
      closedAt: '2026-10-28T14:22:10Z',
      updatedAt: '2026-10-28T14:22:10Z',
      additions: 66,
      deletions: 1,
      changedFiles: 2,
      repository: {
        nameWithOwner: 'RunMaestro/Maestro',
        url: 'https://github.com/RunMaestro/Maestro',
        isPrivate: false,
        isFork: false,
        primaryLanguage: { name: 'TypeScript' }
      }
    },
    {
      number: 1042,
      title: 'feat(stream): add backpressure buffer management for websocket ingestion',
      url: 'https://github.com/open-telemetry/opentelemetry-node/pull/1042',
      state: 'OPEN',
      isDraft: false,
      createdAt: '2026-10-29T16:00:00Z',
      mergedAt: null,
      closedAt: null,
      updatedAt: '2026-10-29T18:00:00Z',
      additions: 112,
      deletions: 14,
      changedFiles: 3,
      repository: {
        nameWithOwner: 'open-telemetry/opentelemetry-node',
        url: 'https://github.com/open-telemetry/opentelemetry-node',
        isPrivate: false,
        isFork: false,
        primaryLanguage: { name: 'TypeScript' }
      }
    },
    {
      number: 588,
      title: 'refactor(compiler): experimental bytecode cache optimization',
      url: 'https://github.com/swc-project/swc/pull/588',
      state: 'OPEN',
      isDraft: true,
      createdAt: '2026-10-30T09:00:00Z',
      mergedAt: null,
      closedAt: null,
      updatedAt: '2026-10-30T10:30:00Z',
      additions: 230,
      deletions: 45,
      changedFiles: 5,
      repository: {
        nameWithOwner: 'swc-project/swc',
        url: 'https://github.com/swc-project/swc',
        isPrivate: false,
        isFork: false,
        primaryLanguage: { name: 'Rust' }
      }
    },
    {
      number: 450,
      title: 'docs(architecture): clarify worker pool concurrency constraints',
      url: 'https://github.com/fastify/fastify/pull/450',
      state: 'CLOSED',
      isDraft: false,
      createdAt: '2026-10-25T11:00:00Z',
      mergedAt: null,
      closedAt: '2026-10-26T08:00:00Z',
      updatedAt: '2026-10-26T08:00:00Z',
      additions: 15,
      deletions: 3,
      changedFiles: 1,
      repository: {
        nameWithOwner: 'fastify/fastify',
        url: 'https://github.com/fastify/fastify',
        isPrivate: false,
        isFork: false,
        primaryLanguage: { name: 'JavaScript' }
      }
    }
  ];
}

async function fetchAllPullRequests(username, token, isMock = false) {
  if (isMock) {
    console.log(`[INFO] Running in mock mode for username: ${username}`);
    return getMockPRs(username);
  }

  const searchQuery = `is:pr author:${username} -user:${username}`;
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
  const isDryRun = Boolean(cliArgs['dry-run']);
  const isMock = Boolean(cliArgs.mock);

  console.log(`====================================================`);
  console.log(`GitHub OSS Contributions GraphQL Sync`);
  console.log(`Target Author: @${username} (external repositories only)`);
  console.log(`Dry Run: ${isDryRun} | Mock Mode: ${isMock}`);
  console.log(`====================================================`);

  let token = null;
  if (!isMock) {
    token = resolveToken(cliArgs.token);
    if (!token) {
      console.error(`[ERROR] No GitHub token found.`);
      console.error(`Please provide a token via GH_TOKEN, GITHUB_TOKEN, CONTRIBUTIONS_TOKEN, or --token <token>.`);
      console.error(`In local development, you can also log in via 'gh auth login'.`);
      process.exit(1);
    }
  }

  // Read existing contributions
  let existingContributions = [];
  try {
    existingContributions = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
    console.log(`[INFO] Loaded ${existingContributions.length} existing contributions from ${DATA_FILE}`);
  } catch (err) {
    console.warn(`[WARN] Could not read existing data file (${err.message}). Starting fresh.`);
  }

  const rawPRs = await fetchAllPullRequests(username, token, isMock);

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

    const transformed = transformPullRequest(raw);
    if (transformed) {
      fetchedContributions.push(transformed);
    }
  }

  console.log(`[INFO] Transformed ${fetchedContributions.length} external pull requests.`);

  // Merge map: existing entries keyed by id
  const contributionMap = new Map();
  for (const item of existingContributions) {
    if (item.id) contributionMap.set(item.id, item);
  }

  // Update / insert fetched entries
  let addedCount = 0;
  let updatedCount = 0;

  for (const fetched of fetchedContributions) {
    if (contributionMap.has(fetched.id)) {
      const existing = contributionMap.get(fetched.id);
      contributionMap.set(fetched.id, {
        ...existing,
        ...fetched,
        stats: {
          ...existing.stats,
          ...fetched.stats
        }
      });
      updatedCount++;
    } else {
      contributionMap.set(fetched.id, fetched);
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

