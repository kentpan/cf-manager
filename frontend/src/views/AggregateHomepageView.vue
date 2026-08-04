<template>
  <div :class="['aggregate-homepage', `aggregate-homepage--${theme}`]">
    <div class="ah-container">
      <!-- Header -->
      <header class="ah-header">
        <div class="ah-header__title-wrap">
          <h1 class="ah-header__title">{{ config.title || '作品集' }}</h1>
          <p class="ah-header__subtitle">{{ config.subtitle || 'Projects & Demos' }}</p>
        </div>
        <div class="ah-header__meta">
          <span class="ah-header__count">{{ config.items.length }} 个项目</span>
          <a
            v-if="adminUrl"
            :href="adminUrl"
            class="ah-header__admin-link"
            :title="`管理后台 (${adminUrl})`"
          >管理 →</a>
        </div>
      </header>

      <!-- Loading state -->
      <div v-if="loading" class="ah-loading">
        <div class="ah-loading__spinner"></div>
        <p>加载中...</p>
      </div>

      <!-- Empty state -->
      <div v-else-if="!config.enabled || config.items.length === 0" class="ah-empty">
        <div class="ah-empty__icon">📦</div>
        <p class="ah-empty__title">暂无展示项目</p>
        <p class="ah-empty__hint">请在管理后台「设置 → 聚合首页」中添加要展示的 Workers / Pages 项目</p>
      </div>

      <!-- Project grid -->
      <main v-else class="ah-grid">
        <a
          v-for="item in config.items"
          :key="`${item.account_name}-${item.display_name}`"
          :href="item.url"
          target="_blank"
          rel="noopener noreferrer"
          :class="['ah-card', `ah-card--${item.type}`]"
        >
          <div class="ah-card__head">
            <div :class="['ah-card__icon', `ah-card__icon--${item.type}`]">
              {{ item.type === 'pages' ? '📄' : '⚡' }}
            </div>
            <div class="ah-card__title-wrap">
              <h3 class="ah-card__title">{{ item.display_name }}</h3>
              <span :class="['ah-card__type', `ah-card__type--${item.type}`]">{{ item.type === 'pages' ? 'Pages' : 'Worker' }}</span>
            </div>
          </div>
          <div class="ah-card__body">
            <div class="ah-card__url">{{ item.url }}</div>
            <div class="ah-card__account">
              <span class="ah-card__account-label">所属账号:</span>
              <span class="ah-card__account-value">{{ item.account_name }}</span>
            </div>
          </div>
          <div class="ah-card__footer">
            <span class="ah-card__visit">访问 ↗</span>
          </div>
        </a>
      </main>

      <!-- Footer -->
      <footer class="ah-footer">
        <p>Powered by <a href="https://github.com/hefy2027/cf-manager" target="_blank" rel="noopener noreferrer">CF Manager</a></p>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

interface AggregateItem {
  display_name: string;
  type: 'worker' | 'pages';
  account_name: string;
  url: string;
  sort_order: number;
}
interface AggregateConfig {
  enabled: boolean;
  theme: 'default' | 'brutalism';
  title: string;
  subtitle: string;
  items: AggregateItem[];
}

const config = ref<AggregateConfig>({
  enabled: false,
  theme: 'default',
  title: '作品集',
  subtitle: 'Projects & Demos',
  items: [],
});
const loading = ref(true);
const theme = computed(() => config.value.theme);

// The admin dashboard URL. When BASE_URL is '/', the admin is at '/#/dashboard'
// (or '/accounts' etc). When BASE_URL is '/admin/', it's at '/admin/#/dashboard'.
// We just link to '/#/settings' which works regardless of BASE_URL because
// vue-router resolves relative to the configured base.
const adminUrl = '/#/settings';

async function loadConfig() {
  loading.value = true;
  try {
    const resp = await fetch('/api/aggregate-homepage');
    const data = await resp.json();
    config.value = {
      enabled: !!data.enabled,
      theme: data.theme === 'brutalism' ? 'brutalism' : 'default',
      title: data.title || '作品集',
      subtitle: data.subtitle || 'Projects & Demos',
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch (e) {
    console.error('[AggregateHomepage] load failed:', e);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadConfig();
});
</script>

<style scoped>
/* ===== Default theme — clean green-accent cards ===== */
.aggregate-homepage {
  min-height: 100vh;
  background: linear-gradient(135deg, #f8fef9 0%, #f0f8f4 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #1a2b22;
  padding: 32px 16px;
  box-sizing: border-box;
}
.aggregate-homepage--brutalism {
  background: #ffe500;
  color: #000;
  font-family: 'Courier New', 'SF Mono', monospace;
}

.ah-container {
  max-width: 1200px;
  margin: 0 auto;
}

/* Header */
.ah-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  padding-bottom: 24px;
  border-bottom: 2px solid rgba(24, 160, 88, 0.15);
  margin-bottom: 32px;
  flex-wrap: wrap;
  gap: 16px;
}
.aggregate-homepage--brutalism .ah-header {
  border-bottom: 4px solid #000;
}
.ah-header__title {
  margin: 0;
  font-size: 36px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #0e7c4a;
}
.aggregate-homepage--brutalism .ah-header__title {
  color: #000;
  font-size: 48px;
  text-transform: uppercase;
  letter-spacing: -0.04em;
}
.ah-header__subtitle {
  margin: 4px 0 0;
  font-size: 16px;
  color: #5a7a6a;
  font-weight: 400;
}
.aggregate-homepage--brutalism .ah-header__subtitle {
  color: #000;
  font-weight: 700;
}
.ah-header__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.ah-header__count {
  font-size: 14px;
  color: #5a7a6a;
  background: rgba(24, 160, 88, 0.1);
  padding: 4px 10px;
  border-radius: 12px;
}
.aggregate-homepage--brutalism .ah-header__count {
  background: #000;
  color: #ffe500;
  border: 2px solid #000;
  padding: 4px 12px;
  font-weight: 700;
}
.ah-header__admin-link {
  font-size: 13px;
  color: #18a058;
  text-decoration: none;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.15s;
}
.ah-header__admin-link:hover {
  background: rgba(24, 160, 88, 0.1);
}
.aggregate-homepage--brutalism .ah-header__admin-link {
  color: #000;
  background: #fff;
  border: 2px solid #000;
  padding: 4px 10px;
  font-weight: 700;
  text-transform: uppercase;
}
.aggregate-homepage--brutalism .ah-header__admin-link:hover {
  background: #000;
  color: #ffe500;
}

/* Loading */
.ah-loading {
  text-align: center;
  padding: 80px 0;
  color: #5a7a6a;
}
.ah-loading__spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(24, 160, 88, 0.2);
  border-top-color: #18a058;
  border-radius: 50%;
  margin: 0 auto 12px;
  animation: ah-spin 0.8s linear infinite;
}
@keyframes ah-spin {
  to { transform: rotate(360deg); }
}

/* Empty */
.ah-empty {
  text-align: center;
  padding: 80px 20px;
}
.ah-empty__icon {
  font-size: 48px;
  margin-bottom: 12px;
}
.ah-empty__title {
  font-size: 18px;
  font-weight: 600;
  color: #1a2b22;
  margin: 0 0 4px;
}
.ah-empty__hint {
  font-size: 14px;
  color: #5a7a6a;
  margin: 0;
}

/* Grid */
.ah-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
.aggregate-homepage--brutalism .ah-grid {
  gap: 0;
  border: 4px solid #000;
  background: #fff;
}
.aggregate-homepage--brutalism .ah-grid > .ah-card {
  border: 2px solid #000;
  margin: -2px 0 0 -2px;
}

/* Cards */
.ah-card {
  display: flex;
  flex-direction: column;
  padding: 18px;
  background: #fff;
  border: 1px solid rgba(24, 160, 88, 0.15);
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.ah-card:hover {
  border-color: #18a058;
  box-shadow: 0 6px 20px rgba(24, 160, 88, 0.15);
  transform: translateY(-2px);
}
.aggregate-homepage--brutalism .ah-card {
  border-radius: 0;
  background: #fff;
  box-shadow: 6px 6px 0 #000;
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}
.aggregate-homepage--brutalism .ah-card:hover {
  transform: translate(-3px, -3px);
  box-shadow: 9px 9px 0 #000;
}

.ah-card__head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.ah-card__icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}
.ah-card__icon--worker {
  background: linear-gradient(135deg, #18a058, #36ad6a);
  color: #fff;
}
.ah-card__icon--pages {
  background: linear-gradient(135deg, #f5a623, #f97316);
  color: #fff;
}
.aggregate-homepage--brutalism .ah-card__icon {
  border-radius: 0;
  border: 3px solid #000;
  background: #ffe500 !important;
}
.aggregate-homepage--brutalism .ah-card__icon--pages {
  background: #fff !important;
}
.ah-card__title-wrap {
  flex: 1;
  min-width: 0;
}
.ah-card__title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #0e7c4a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.aggregate-homepage--brutalism .ah-card__title {
  color: #000;
  text-transform: uppercase;
}
.ah-card__type {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}
.ah-card__type--worker {
  background: rgba(24, 160, 88, 0.12);
  color: #18a058;
}
.ah-card__type--pages {
  background: rgba(245, 166, 35, 0.12);
  color: #f97316;
}
.aggregate-homepage--brutalism .ah-card__type {
  border: 2px solid #000;
  background: #fff;
  color: #000;
}

.ah-card__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.ah-card__url {
  font-size: 12px;
  color: #5a7a6a;
  font-family: 'SF Mono', 'Monaco', monospace;
  word-break: break-all;
  background: rgba(24, 160, 88, 0.04);
  padding: 6px 8px;
  border-radius: 4px;
}
.aggregate-homepage--brutalism .ah-card__url {
  background: #fff;
  border: 2px solid #000;
  padding: 6px 8px;
  color: #000;
  font-weight: 700;
}
.ah-card__account {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.ah-card__account-label {
  color: #8aa;
}
.ah-card__account-value {
  color: #1a2b22;
  font-weight: 500;
}
.aggregate-homepage--brutalism .ah-card__account-label,
.aggregate-homepage--brutalism .ah-card__account-value {
  color: #000;
}

.ah-card__footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 10px;
  border-top: 1px solid rgba(24, 160, 88, 0.1);
}
.aggregate-homepage--brutalism .ah-card__footer {
  border-top: 2px solid #000;
}
.ah-card__visit {
  font-size: 13px;
  color: #18a058;
  font-weight: 600;
}
.aggregate-homepage--brutalism .ah-card__visit {
  color: #000;
  background: #ffe500;
  padding: 4px 8px;
  border: 2px solid #000;
  font-weight: 700;
  text-transform: uppercase;
}

/* Footer */
.ah-footer {
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid rgba(24, 160, 88, 0.15);
  text-align: center;
  font-size: 12px;
  color: #8aa;
}
.aggregate-homepage--brutalism .ah-footer {
  border-top: 4px solid #000;
  color: #000;
  font-weight: 700;
  text-transform: uppercase;
}
.ah-footer a {
  color: #18a058;
  text-decoration: none;
}
.ah-footer a:hover {
  text-decoration: underline;
}
.aggregate-homepage--brutalism .ah-footer a {
  color: #000;
  text-decoration: underline;
  text-decoration-thickness: 2px;
}

/* Responsive */
@media (max-width: 640px) {
  .ah-header__title {
    font-size: 28px;
  }
  .aggregate-homepage--brutalism .ah-header__title {
    font-size: 32px;
  }
  .ah-grid {
    grid-template-columns: 1fr;
  }
}
</style>
