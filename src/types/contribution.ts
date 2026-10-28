export interface ContributionStats {
  additions: number;
  deletions: number;
  filesChanged?: number;
}

export interface Contribution {
  id: string;
  repo: string;
  repoUrl: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  status: 'merged' | 'in_review' | 'closed';
  mergedAt: string; // ISO format: YYYY-MM-DD
  language: string;
  stats?: ContributionStats;
}

export interface ProfileConfig {
  name: string;
  handle: string;
  bio: string;
  avatarUrl: string;
  avatarFallbackInitials: string;
  links: {
    website: string;
    github: string;
    projectRepo: string;
    linkedin?: string;
    twitter?: string;
    email?: string;
  };
  siteTitle: string;
  siteDescription: string;
}

