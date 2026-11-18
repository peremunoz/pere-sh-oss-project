export interface CompanyInfo {
  id: string;
  name: string;
  account: string;
}

export function getCompanyForRepo(repo: string): CompanyInfo | null {
  const repoLower = (repo || '').toLowerCase().trim();

  if (repoLower.startsWith('microsoft/') || repoLower === 'microsoft') {
    return {
      id: 'microsoft',
      name: 'Microsoft',
      account: 'microsoft',
    };
  }

  if (repoLower.startsWith('vuejs/') || repoLower === 'vuejs') {
    return {
      id: 'vuejs',
      name: 'Vue.js',
      account: 'vuejs',
    };
  }

  return null;
}
