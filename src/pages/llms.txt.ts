import type { APIRoute } from 'astro';
import contributions from '../data/contributions.json';
import { profileConfig } from '../config';

export const GET: APIRoute = async () => {
  const totalMerged = contributions.filter(c => c.status === 'merged').length;
  const uniqueRepos = new Set(contributions.map(c => c.repo)).size;
  const totalAdditions = contributions.reduce((acc, c) => acc + (c.stats?.additions || 0), 0);
  const totalDeletions = contributions.reduce((acc, c) => acc + (c.stats?.deletions || 0), 0);
  const totalFilesChanged = contributions.reduce((acc, c) => acc + (c.stats?.filesChanged || 0), 0);

  const lines: string[] = [];

  lines.push(`# ${profileConfig.siteTitle}`);
  lines.push(`> ${profileConfig.siteDescription}`);
  lines.push('');
  lines.push(`Author: ${profileConfig.name} (${profileConfig.links.website})`);
  lines.push(`GitHub: ${profileConfig.links.github}`);
  lines.push(`Repository: ${profileConfig.links.projectRepo}`);
  lines.push('');
  lines.push('## Overview');
  lines.push(profileConfig.bio);
  lines.push('');
  lines.push('## Live Aggregate Metrics');
  lines.push(`- Merged Pull Requests: ${totalMerged}`);
  lines.push(`- Repositories Impacted: ${uniqueRepos}`);
  lines.push(`- Total Lines Added: +${totalAdditions}`);
  lines.push(`- Total Lines Removed: -${totalDeletions}`);
  lines.push(`- Total Files Modified: ${totalFilesChanged}`);
  lines.push('');
  lines.push('## Delivery Model (Agentic Pipeline)');
  lines.push('Every contribution in this showroom was developed using a hybrid agentic architecture:');
  lines.push('1. Issue Discovery (AI Agent): Identifies valid issues, bugs, and missing features across open-source repositories.');
  lines.push('2. Implementation (AI Agent): Inspects codebase, diagnoses root cause, implements minimal robust patch, and runs tests.');
  lines.push('3. Verification (Human Review): Rigorous human-in-the-loop audit by Pere Muñoz verifying correctness, edge cases, and repo conventions.');
  lines.push('4. Merged to Production (Maintainer Review): Upstream project maintainers review, approve, and merge into production.');
  lines.push('');
  lines.push('## Merged Pull Requests');
  for (const c of contributions) {
    const statsStr = c.stats ? ` (+${c.stats.additions} -${c.stats.deletions}, ${c.stats.filesChanged} files)` : '';
    lines.push(`- [${c.repo} #${c.prNumber}](${c.prUrl}): ${c.prTitle} (${c.language})${statsStr} - Merged ${c.mergedAt}`);
  }
  lines.push('');
  lines.push('## Links');
  lines.push('- [Full LLM Dump](https://oss.pere.sh/llms-full.txt): Complete detailed text representation for AI agents');
  lines.push(`- [Personal Website](${profileConfig.links.website}): Pere Muñoz homepage`);
  lines.push(`- [GitHub Profile](${profileConfig.links.github}): Contributions, code, and activity`);
  lines.push(`- [Project Showcase Source](${profileConfig.links.projectRepo}): Source code of this Astro site`);
  lines.push('');

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};

