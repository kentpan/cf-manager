<template>
  <div class="home-redirect">
    <div class="home-redirect__spinner"></div>
    <p class="home-redirect__text">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useRoute } from 'vue-router';

const router = useRouter();
const route = useRoute();
const message = ref('加载中...');

onMounted(async () => {
  // If the user explicitly requested the aggregate homepage (e.g. via the
  // 'preview' link in settings), render it directly without checking the
  // config. This lets the admin preview the page even when the toggle is
  // off.
  if (route.query.home === '1') {
    router.replace({ name: 'aggregate-homepage' });
    return;
  }

  // Otherwise, check the aggregate-homepage config. When enabled, show the
  // portfolio page; when disabled, redirect to the admin dashboard (which
  // respects the configured BASE_URL automatically via vue-router).
  try {
    const resp = await fetch('/api/aggregate-homepage');
    const data = await resp.json();
    if (data.enabled) {
      router.replace({ name: 'aggregate-homepage' });
    } else {
      message.value = '跳转到管理后台...';
      router.replace({ name: 'dashboard' });
    }
  } catch {
    // If the config endpoint fails (e.g. backend down), fall back to the
    // admin dashboard which will show a proper error.
    router.replace({ name: 'dashboard' });
  }
});
</script>

<style scoped>
.home-redirect {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: #f8fef9;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.home-redirect__spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(24, 160, 88, 0.2);
  border-top-color: #18a058;
  border-radius: 50%;
  animation: home-redirect-spin 0.8s linear infinite;
}
.home-redirect__text {
  margin: 0;
  font-size: 13px;
  color: #5a7a6a;
}
@keyframes home-redirect-spin {
  to { transform: rotate(360deg); }
}
</style>
