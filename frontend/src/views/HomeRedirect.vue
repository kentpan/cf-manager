<template>
  <div class="home-redirect">
    <!-- 加载中 -->
    <div v-if="loading" class="home-redirect__loading">
      <div class="home-redirect__spinner"></div>
      <p class="home-redirect__text">{{ message }}</p>
    </div>

    <!-- 聚合首页禁用：显示伪装的 nginx 默认页（与 worker 端 getFakeNginxPage 行为一致） -->
    <div v-else-if="!config.enabled" class="fake-nginx" v-html="fakeNginxHtml" />

    <!-- 聚合首页启用：内联渲染聚合首页内容 -->
    <div v-else :class="['aggregate-homepage', `aggregate-homepage--${config.theme}`]">
      <div class="ah-container">
        <header class="ah-header">
          <div class="ah-header__title-wrap">
            <h1 class="ah-header__title">{{ config.title || '作品集' }}</h1>
            <p class="ah-header__subtitle">{{ config.subtitle || 'Projects & Demos' }}</p>
          </div>
          <div class="ah-header__meta">
            <span class="ah-header__count">{{ config.items.length }} 个项目</span>
          </div>
        </header>
        <main class="ah-grid">
          <a
            v-for="item in config.items"
            :key="item.url"
            :href="item.url"
            target="_blank"
            rel="noopener noreferrer"
            :class="['ah-card', `ah-card--${item.type}`]"
          >
            <div class="ah-card__screenshot-wrap">
              <img v-if="item.screenshot" :src="item.screenshot" :alt="item.display_name" class="ah-card__screenshot" loading="lazy" />
              <div v-else class="ah-card__screenshot-placeholder">
                <span class="ah-card__screenshot-icon">{{ item.type === 'pages' ? '📄' : '⚡' }}</span>
              </div>
              <span :class="['ah-card__type-badge', `ah-card__type-badge--${item.type}`]">{{ item.type === 'pages' ? 'Pages' : 'Worker' }}</span>
            </div>
            <div class="ah-card__body">
              <h3 class="ah-card__title">{{ item.title || item.display_name }}</h3>
              <p v-if="item.description" class="ah-card__description">{{ item.description }}</p>
              <div class="ah-card__url">{{ item.url }}</div>
            </div>
            <div class="ah-card__footer"><span class="ah-card__visit">访问 ↗</span></div>
          </a>
        </main>
        <footer class="ah-footer"><p>Powered by <a href="https://dist.ccwu.cc" target="_blank" rel="noopener noreferrer">CF Manager</a></p></footer>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface AggregateItem {
  display_name: string;
  type: 'worker' | 'pages';
  url: string;
  sort_order: number;
  title: string;
  description: string;
  screenshot: string;
}
interface AggregateConfig {
  enabled: boolean;
  theme: 'default' | 'brutalism';
  title: string;
  subtitle: string;
  items: AggregateItem[];
}

const loading = ref(true);
const message = ref('加载中...');
const config = ref<AggregateConfig>({
  enabled: false,
  theme: 'default',
  title: '作品集',
  subtitle: 'Projects & Demos',
  items: [],
});

// 伪装的 nginx 默认欢迎页（与 worker/src/pages/fakeNginx.ts 保持一致）
const fakeNginxHtml = `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body {
    width: 35em;
    margin: 0 auto;
    font-family: Tahoma, Verdana, Arial, sans-serif;
}
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>`;

onMounted(async () => {
  try {
    const resp = await fetch('/api/aggregate-homepage');
    const json = await resp.json();
    const data = json.data || {};
    config.value = {
      enabled: !!data.enabled,
      theme: data.theme === 'brutalism' ? 'brutalism' : 'default',
      title: data.title || '作品集',
      subtitle: data.subtitle || 'Projects & Demos',
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch(error: any) {
    // Config endpoint failed — 默认显示 fakeNginx（聚合首页禁用态）
    console.error('Failed to fetch aggregate homepage config', error);
  }
  loading.value = false;
});
</script>

<style scoped>
.home-redirect { min-height: 100vh; }
/* v-html 渲染的 fakeNginx 页面使用 :deep 让内部样式生效 */
.fake-nginx { min-height: 100vh; }
.home-redirect__loading {
  position: fixed; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
  background: #f8fef9;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.home-redirect__spinner {
  width: 28px; height: 28px;
  border: 3px solid rgba(24,160,88,0.2);
  border-top-color: #18a058;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.home-redirect__text { margin: 0; font-size: 13px; color: #5a7a6a; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Aggregate homepage — default theme */
.aggregate-homepage {
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
  box-sizing: border-box;
}
.aggregate-homepage * { box-sizing: border-box; }
.ah-container { max-width: 1200px; margin: 0 auto; padding: 32px 16px; }
.ah-header {
  display: flex; justify-content: space-between; align-items: flex-end;
  padding-bottom: 24px; margin-bottom: 32px; flex-wrap: wrap; gap: 16px;
  border-bottom: 2px solid #e2e8f0;
}
.ah-header__title { margin: 0; font-size: 36px; font-weight: 800; letter-spacing: -0.02em; color: #0f172a; }
.ah-header__subtitle { margin: 4px 0 0; font-size: 16px; color: #64748b; }
.ah-header__count { font-size: 14px; padding: 4px 10px; border-radius: 12px; background: rgba(24,160,88,0.1); color: #18a058; }
.ah-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 24px; }
.ah-card {
  display: flex; flex-direction: column; text-decoration: none; color: inherit;
  overflow: hidden; transition: all 0.2s ease; min-height: 320px;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.ah-card:hover { border-color: #18a058; box-shadow: 0 6px 20px rgba(24,160,88,0.15); transform: translateY(-2px); }
.ah-card__screenshot-wrap { position: relative; width: 100%; aspect-ratio: 16/9; overflow: hidden; background: #f5f5f5; }
.ah-card__screenshot { width: 100%; height: 100%; object-fit: cover; display: block; }
.ah-card__screenshot-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg,#f0f4f8,#e8edf3); }
.ah-card__screenshot-icon { font-size: 36px; opacity: 0.4; }
.ah-card__type-badge { position: absolute; top: 8px; right: 8px; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; }
.ah-card__type-badge--worker { background: rgba(24,160,88,0.9); color: #fff; }
.ah-card__type-badge--pages { background: rgba(245,166,35,0.9); color: #fff; }
.ah-card__body { flex: 1; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
.ah-card__title { margin: 0; font-size: 15px; font-weight: 700; color: #0f172a; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ah-card__description { margin: 0; font-size: 12px; color: #64748b; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ah-card__url { font-size: 11px; font-family: monospace; word-break: break-all; padding: 4px 6px; border-radius: 4px; background: #f1f5f9; color: #64748b; }
.ah-card__footer { display: flex; justify-content: flex-end; padding: 10px 16px; border-top: 1px solid #f1f5f9; }
.ah-card__visit { font-size: 13px; font-weight: 600; color: #18a058; }
.ah-footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; }
.ah-footer a { color: #18a058; text-decoration: none; }
.ah-footer a:hover { text-decoration: underline; }

/* Brutalism theme */
.aggregate-homepage--brutalism {
  background: #EFEDE4; color: #1A1A1A;
}
.aggregate-homepage--brutalism .ah-header { border-bottom: 3px solid #1A1A1A; }
.aggregate-homepage--brutalism .ah-header__title { color: #1A1A1A; font-weight: 900; }
.aggregate-homepage--brutalism .ah-header__subtitle { color: #3D3D3D; font-weight: 600; }
.aggregate-homepage--brutalism .ah-header__count { background: #1A1A1A; color: #EFEDE4; border: 2px solid #1A1A1A; box-shadow: 3px 3px 0 #1A1A1A; }
.aggregate-homepage--brutalism .ah-card {
  background: #FAF8F2; border: 2px solid #1A1A1A; border-radius: 10px;
  box-shadow: 4px 4px 0 #1A1A1A; margin-bottom: 4px; overflow: visible;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.aggregate-homepage--brutalism .ah-card:hover { transform: translate(-2px,-2px); box-shadow: 6px 6px 0 #1A1A1A; }
.aggregate-homepage--brutalism .ah-card__screenshot-wrap { border-bottom: 2px solid #1A1A1A; background: #E5E1D4; border-radius: 8px 8px 0 0; overflow: hidden; }
.aggregate-homepage--brutalism .ah-card__screenshot-placeholder { background: #E5E1D4; }
.aggregate-homepage--brutalism .ah-card__type-badge { border: 2px solid #1A1A1A; box-shadow: 2px 2px 0 #1A1A1A; font-weight: 700; }
.aggregate-homepage--brutalism .ah-card__type-badge--worker { background: #4A9EAB; color: #fff; }
.aggregate-homepage--brutalism .ah-card__type-badge--pages { background: #E85A4F; color: #fff; }
.aggregate-homepage--brutalism .ah-card__title { color: #1A1A1A; font-weight: 800; }
.aggregate-homepage--brutalism .ah-card__description { color: #3D3D3D; }
.aggregate-homepage--brutalism .ah-card__url { background: #E5E1D4; color: #3D3D3D; border: 1px solid #1A1A1A; font-weight: 600; }
.aggregate-homepage--brutalism .ah-card__footer { border-top: 2px solid #1A1A1A; }
.aggregate-homepage--brutalism .ah-card__visit { background: #4A9EAB; color: #fff; padding: 4px 10px; border: 2px solid #1A1A1A; border-radius: 6px; box-shadow: 2px 2px 0 #1A1A1A; font-weight: 700; text-transform: uppercase; font-size: 12px; }
.aggregate-homepage--brutalism .ah-footer { border-top: 3px solid #1A1A1A; color: #1A1A1A; font-weight: 700; }
.aggregate-homepage--brutalism .ah-footer a { color: #4A9EAB; text-decoration: underline; text-decoration-thickness: 2px; }

@media (max-width: 640px) {
  .ah-header__title { font-size: 28px; }
  .ah-grid { grid-template-columns: 1fr; }
}
</style>
