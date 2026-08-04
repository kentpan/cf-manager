import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  // The aggregate homepage is a public, unauthenticated landing page that
  // shows a curated portfolio of Workers + Pages projects. It's mounted at
  // the root path so visitors land on it when BASE_URL='/'. The AdminApp
  // (defined below) handles all the authenticated admin routes; when the
  // aggregate homepage is disabled, '/' redirects to '/dashboard'.
  { path: '/', name: 'home', component: () => import('../views/HomeRedirect.vue') },
  { path: '/dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
  { path: '/accounts', name: 'accounts', component: () => import('../views/AccountsView.vue') },
  { path: '/domain-providers', name: 'domain-providers', component: () => import('../views/DomainProvidersView.vue') },
  { path: '/dns', name: 'dns', component: () => import('../views/DnsView.vue') },
  { path: '/workers', name: 'workers', component: () => import('../views/WorkersView.vue') },
  { path: '/pages-aggregator', name: 'pages-aggregator', component: () => import('../views/PagesAggregatorView.vue') },
  { path: '/ai', name: 'ai', component: () => import('../views/AiView.vue') },
  { path: '/storage', name: 'storage', component: () => import('../views/StorageView.vue') },
  { path: '/browser-render', name: 'browser-render', component: () => import('../views/BrowserRenderView.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
  { path: '/store', name: 'store', component: () => import('../views/StoreView.vue') },
  { path: '/tunnels', name: 'tunnels', component: () => import('../views/TunnelsView.vue'), meta: { title: '隧道/回源' } },
  // Aggregate homepage view — a standalone public page (no admin layout).
  // Reached when the user clicks 'preview' in settings, or directly via
  // '/?home=1' to bypass the auto-redirect logic in HomeRedirect.
  { path: '/aggregate-homepage', name: 'aggregate-homepage', component: () => import('../views/AggregateHomepageView.vue') },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

export default router;
