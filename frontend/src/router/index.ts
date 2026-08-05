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

// Router base 动态化：生产环境前端构建时 VITE_BASE_URL=/admin/，但访问 /
// 或 /aggregate-homepage 时 pathname 不在 /admin/ 下，会导致 vue-router
// 无法匹配并重定向到 /admin/。这里按当前 pathname 动态选择 base：
//   - /admin/*  → base=/admin/（admin 后台入口）
//   - 其他      → base=/（聚合首页 / 深链接刷新）
const base = window.location.pathname.startsWith('/admin') ? '/admin/' : '/';

const router = createRouter({
  history: createWebHistory(base),
  routes,
});

// admin path 下访问根路径（即 /admin/）自动重定向到 dashboard —— admin 入口
// 应显示登录/dashboard，而不是 HomeRedirect（聚合首页）。
router.beforeEach((to) => {
  if (base === '/admin/' && to.name === 'home') {
    return { name: 'dashboard' };
  }
});

export default router;
