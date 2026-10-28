#!/usr/bin/env node
/**
 * Utility script for the automated agent (or human) to record a merged pull request.
 *
 * Usage:
 *   node scripts/add-contribution.mjs \
 *     --repo "shoelace-style/webawesome" \
 *     --pr 2946 \
 *     --title "fix(dropdown-item): respect preventDefault() on clicks" \
 *     --url "https://github.com/shoelace-style/webawesome/pull/2946" \
 *     --lang "TypeScript" \
 *     --additions 18 \
 *     --deletions 3
 *
 * Or passing a JSON payload directly:
 *   node scripts/add-contribution.mjs --json '{"repo":"...","prNumber":123,...}'
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = resolve(__dirname, '../src/data/contributions.json');

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

function normalizeContribution(raw) {
  const prNumber = raw.prNumber || raw.number;
  const prTitle = raw.prTitle || raw.title;
  const prUrl = raw.prUrl || raw.url;

  if (!raw.repo || !prNumber || !prTitle || !prUrl) {
    throw new Error('Missing required fields: --repo, --pr (or number), --title, and --url are mandatory.');
  }

  const id = raw.id || `${raw.repo.replace(/[^a-zA-Z0-9]/g, '-')}-${prNumber}`.toLowerCase();
  const repoUrl = raw.repoUrl || (raw.repo.startsWith('http') ? raw.repo : `https://github.com/${raw.repo.replace(/^https?:\/\/github\.com\//, '')}`);
  const language = raw.language || raw.lang || 'Code';

  // Clean mergedAt date
  let mergedAt = raw.mergedAt ? String(raw.mergedAt).split('T')[0] : new Date().toISOString().split('T')[0];

  return {
    id,
    repo: raw.repo.replace(/^https?:\/\/github\.com\//, ''),
    repoUrl,
    prNumber: Number(prNumber),
    prTitle: String(prTitle).trim(),
    prUrl: String(prUrl).trim(),
    status: raw.status || 'merged',
    mergedAt,
    language,
    stats: {
      additions: Number(raw.additions || raw.stats?.additions || 0),
      deletions: Number(raw.deletions || raw.stats?.deletions || 0),
      ...((raw.filesChanged || raw.changedFiles || raw.stats?.filesChanged)
        ? { filesChanged: Number(raw.filesChanged || raw.changedFiles || raw.stats?.filesChanged) }
        : {})
    }
  };
}

function run() {
  const cliArgs = parseArgs(process.argv.slice(2));

  if (cliArgs.help || cliArgs.h || Object.keys(cliArgs).length === 0) {
    console.log(`
Usage:
  node scripts/add-contribution.mjs --repo <owner/repo> --pr <number> --title <title> --url <pr_url> [options]

Options:
  --repo <repo>          GitHub repository (e.g. "RunMaestro/Maestro") [Required]
  --pr <number>          Pull request number [Required]
  --title <text>         Title of the pull request [Required]
  --url <url>            URL to the pull request [Required]
  --lang <language>      Primary programming language
  --additions <num>      Lines added
  --deletions <num>      Lines deleted
  --files <num>          Files changed
  --mergedAt <YYYY-MM-DD> Merged date (defaults to today)
  --json '<raw_json>'    Pass full JSON payload directly
`);
    return;
  }

  let input = {};

  if (cliArgs.json) {
    input = JSON.parse(cliArgs.json);
  } else {
    input = {
      repo: cliArgs.repo,
      repoUrl: cliArgs.repoUrl,
      prNumber: cliArgs.pr || cliArgs.prNumber,
      prTitle: cliArgs.title || cliArgs.prTitle,
      prUrl: cliArgs.url || cliArgs.prUrl,
      status: cliArgs.status || 'merged',
      mergedAt: cliArgs.mergedAt,
      language: cliArgs.lang || cliArgs.language,
      additions: cliArgs.additions,
      deletions: cliArgs.deletions,
      filesChanged: cliArgs.filesChanged
    };
  }

  const newEntry = normalizeContribution(input);

  let current = [];
  try {
    current = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
  } catch (err) {
    console.warn(`Creating new data file at ${DATA_FILE}`);
  }

  // Remove existing with same id if already present (update in place)
  const filtered = current.filter((item) => item.id !== newEntry.id && !(item.repo === newEntry.repo && item.prNumber === newEntry.prNumber));
  // Prepend to top (latest first)
  const updated = [newEntry, ...filtered];

  writeFileSync(DATA_FILE, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  console.log(`✓ Added contribution: ${newEntry.repo} #${newEntry.prNumber} (${newEntry.prTitle})`);
  console.log(`  Total contributions recorded: ${updated.length}`);
}

run();
