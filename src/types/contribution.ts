export interface ContributionStats {
  additions: number;
  deletions: number;
  filesChanged?: number;
}

export type ContributionStatus = 'merged' | 'open' | 'draft' | 'closed';

export interface Contribution {
  id: string;
  repo: string;
  repoUrl: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  status: ContributionStatus;
  createdAt?: string; // ISO format: YYYY-MM-DD
  mergedAt?: string | null; // ISO format: YYYY-MM-DD
  closedAt?: string | null; // ISO format: YYYY-MM-DD
  updatedAt?: string; // ISO format: YYYY-MM-DD
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

