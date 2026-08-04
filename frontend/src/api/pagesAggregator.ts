import apiClient from './client';

export interface AggregatedPageProject {
  account_id: number;
  account_name: string;
  account_email: string | null;
  cf_account_id: string | null;
  id: string;
  name: string;
  domains: string[];
  production_branch: string;
  created_on: string;
  modified_on: string;
  deployment_count: number;
  source?: { type: string };
}

export interface PagesAggregatorResponse {
  total_projects: number;
  total_accounts: number;
  healthy_accounts: number;
  failed_accounts: Array<{ account_id: number; account_name: string; error: string; error_kind: 'decrypt' | 'api' | null }>;
  accounts: Array<{
    account_id: number;
    account_name: string;
    account_email: string | null;
    cf_account_id: string | null;
    projects: Array<Omit<AggregatedPageProject, 'account_id' | 'account_name' | 'account_email' | 'cf_account_id'>>;
    error: string | null;
    error_kind: 'decrypt' | 'api' | null;
  }>;
  projects: AggregatedPageProject[];
}

export const pagesAggregatorApi = {
  getAll: () => apiClient.get('/pages-aggregator'),
  getDetailed: () => apiClient.get('/pages-aggregator/detailed', { timeout: 120000 }),
};
