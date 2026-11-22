export interface CompanyInfo {
  id: string;
  name: string;
  account: string;
}

const COMPANY_ACCOUNTS: CompanyInfo[] = [
  { id: 'microsoft', name: 'Microsoft', account: 'microsoft' },
  { id: 'vuejs', name: 'Vue.js', account: 'vuejs' },
  { id: 'obsidian', name: 'Obsidian', account: 'obsidianmd' },
];

/** Returns company metadata when a repository belongs to a mapped GitHub account. */
export function getCompanyForRepo(repo: string): CompanyInfo | null {
  const repoLower = (repo || '').toLowerCase().trim();

  return (
    COMPANY_ACCOUNTS.find(
      ({ account }) => repoLower.startsWith(`${account}/`) || repoLower === account
    ) ?? null
  );
}
