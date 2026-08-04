<template>
  <div class="home-redirect">
    <div class="home-redirect__spinner"></div>
    <p class="home-redirect__text">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const message = ref('加载中...');

onMounted(async () => {
  // Check the aggregate-homepage config. When enabled, navigate to the
  // public aggregate homepage (at the root path, NOT under /admin/).
  // When disabled, redirect to the admin dashboard.
  //
  // IMPORTANT: We use window.location.href instead of vue-router's
  // router.replace because the SPA is built with VITE_BASE_URL=/admin/
  // on Cloudflare Pages. vue-router would prepend the base, turning
  // /aggregate-homepage into /admin/aggregate-homepage — which is wrong
  // because the aggregate homepage is a PUBLIC page that must be
  // accessible without API_SECRET auth.
  try {
    const resp = await fetch('/api/aggregate-homepage');
    const data = await resp.json();
    if (data.enabled) {
      // Navigate to /aggregate-homepage at the ROOT path (not /admin/aggregate-homepage).
      // The worker's index.ts serves the SPA index.html for this path.
      window.location.href = '/aggregate-homepage';
    } else {
      message.value = '跳转到管理后台...';
      // Navigate to the admin dashboard (respects BASE_URL).
      // If BASE_URL=/admin/, this goes to /admin/#/dashboard.
      // If BASE_URL=/, this goes to /#/dashboard.
      const base = import.meta.env.BASE_URL || '/';
      window.location.href = `${base}#/dashboard`;
    }
  } catch {
    // If the config endpoint fails (e.g. backend down), fall back to
    // the admin dashboard.
    const base = import.meta.env.BASE_URL || '/';
    window.location.href = `${base}#/dashboard`;
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
