<template>
  <div class="page-view">
    <n-h2>设置</n-h2>

    <n-card title="配置状态" size="small" style="margin-bottom: 16px">
      <n-spin :show="loading">
        <n-descriptions :column="1" bordered label-placement="left">
          <n-descriptions-item label="加密密钥">
            <n-tag :type="settings.encryption_key_configured ? 'success' : 'error'" size="small">
              {{ settings.encryption_key_configured ? '已配置' : '未配置' }}
            </n-tag>
          </n-descriptions-item>
          <n-descriptions-item label="API Secret">
            <n-tag :type="settings.api_secret_configured ? 'success' : 'error'" size="small">
              {{ settings.api_secret_configured ? '已配置' : '未配置' }}
            </n-tag>
          </n-descriptions-item>
          <n-descriptions-item label="Demo 保护账户">
            <n-text v-if="settings.demo_account_ids">{{ settings.demo_account_ids }}</n-text>
            <n-tag v-else size="small" type="default">未配置</n-tag>
          </n-descriptions-item>
          <n-descriptions-item label="数据库路径">
            <n-text>{{ settings.db_path || '-' }}</n-text>
          </n-descriptions-item>
          <n-descriptions-item label="版本">
            <n-text v-if="settings.version">v{{ settings.version }}<n-text v-if="settings.git_commit" depth="3" style="margin-left: 8px; font-size: 12px">{{ settings.git_commit }}</n-text></n-text>
            <n-tag v-else size="small" type="default">未知</n-tag>
          </n-descriptions-item>
        </n-descriptions>
      </n-spin>
    </n-card>

    <n-card v-if="!isWorkerPlatform" title="代理设置" size="small" style="margin-bottom: 16px">
      <n-space vertical>
        <n-space align="center">
          <n-switch :value="proxyEnabled" @update:value="toggleProxy" :loading="proxyToggling" />
          <n-text :depth="proxyEnabled ? 1 : 3">{{ proxyEnabled ? '代理已启用' : '代理已关闭' }}</n-text>
        </n-space>
        <n-input-group>
          <n-input v-model:value="proxyUrl" placeholder="例如: http://127.0.0.1:7890 或 socks5://127.0.0.1:1080" clearable style="flex: 1" />
          <n-button type="info" :loading="proxyTesting" :disabled="!proxyUrl" @click="testProxy">测试</n-button>
          <n-button type="primary" :loading="proxySaving" @click="saveProxy">保存</n-button>
        </n-input-group>
        <n-text depth="3" style="font-size: 12px">
          支持 HTTP/HTTPS 和 SOCKS5 代理协议。此开关仅控制全局默认代理。
          可在「账号管理」中为每个账户单独配置专属代理地址和独立开关，账户开关不受此全局开关影响。
        </n-text>
      </n-space>
    </n-card>

    <!-- baseURL 配置 -->
    <n-card title="前端访问路径 (BASE_URL)" size="small" style="margin-bottom: 16px">
      <n-space vertical>
        <n-alert v-if="settings.is_cloudflare_edge" type="warning" :bordered="false">
          <n-space :size="4" vertical>
            <strong>Cloudflare 边缘运行时检测到</strong>
            <span style="font-size: 12px">
              Cloudflare Pages 部署无法在运行时修改 .env。请前往 Cloudflare Pages 项目 →
              Settings → Environment variables → 修改 <code>BASE_URL</code> 变量,
              然后 Redeploy 让新值生效。
            </span>
          </n-space>
        </n-alert>
        <n-input-group>
          <n-input
            v-model:value="baseUrlInput"
            :disabled="settings.is_cloudflare_edge || !settings.env_writable"
            placeholder="/ (默认根路径) 或 /admin/ (后台路径)"
            style="flex: 1"
          />
          <n-button
            type="primary"
            :loading="baseUrlSaving"
            :disabled="settings.is_cloudflare_edge || !settings.env_writable"
            @click="saveBaseUrl"
          >保存</n-button>
        </n-input-group>
        <n-text depth="3" style="font-size: 12px">
          <strong>当前值:</strong> <code>{{ settings.base_url || '/' }}</code>
          <span v-if="!settings.env_writable && !settings.is_cloudflare_edge" style="color: #e03050; margin-left: 8px">
            ⚠️ .env 不可写, 请手动编辑 cf-manager/.env 后重启后端
          </span>
        </n-text>
        <n-text depth="3" style="font-size: 12px">
          修改后需<strong>重启后端</strong>让 vue-router 加载新路径。
          默认 <code>/</code> 为根路径访问, 设为 <code>/admin/</code> 可隐藏后台入口 (前端 SPA 从 /admin/ 加载)。
        </n-text>
      </n-space>
    </n-card>

    <!-- 聚合首页配置 -->
    <n-card title="聚合首页 (作品集 / Demo 展示)" size="small" style="margin-bottom: 16px">
      <n-space vertical>
        <n-space align="center" justify="space-between">
          <n-space align="center">
            <n-switch :value="aggregateConfig.enabled" @update:value="(v: boolean) => toggleAggregateHomepage(v)" :loading="aggregateSaving" />
            <n-text :depth="aggregateConfig.enabled ? 1 : 3">{{ aggregateConfig.enabled ? '已启用' : '已关闭' }}</n-text>
          </n-space>
          <n-space>
            <n-button size="small" :disabled="!aggregateConfig.enabled" @click="openAggregateSelectionModal">选择展示项目</n-button>
            <n-button size="small" :disabled="!aggregateConfig.enabled" @click="openAggregateStyleModal">主题风格</n-button>
            <n-button size="small" tag="a" :href="'/'" target="_blank" :disabled="!aggregateConfig.enabled">预览</n-button>
          </n-space>
        </n-space>
        <n-alert :type="aggregateConfig.enabled ? 'success' : 'info'" :bordered="false">
          <n-space :size="4" vertical>
            <span>
              <strong>{{ aggregateConfig.enabled ? '已启用' : '未启用' }}</strong>
              · 主题: <code>{{ aggregateConfig.theme === 'brutalism' ? '新粗野主义' : '默认' }}</code>
              · 标题: <code>{{ aggregateConfig.title }}</code>
              · 展示项目: {{ aggregateConfig.items.length }} 个
            </span>
            <span style="font-size: 12px">
              启用后, 访问根路径 <code>/</code> 会显示一个无需鉴权的公开作品集页面,
              展示选中的 Workers + Pages 项目 (自定义域名优先作为链接)。
              关闭后, 根路径自动跳转到后台管理首页。
            </span>
          </n-space>
        </n-alert>
        <n-text depth="3" style="font-size: 12px">
          💡 聚合首页是<strong>公开页面</strong> (无需 API_SECRET 鉴权),
          适合作为项目作品集 / Demo 展示列表页对外展示。可在「主题风格」中切换默认 / 新粗野主义两种视觉风格。
        </n-text>
      </n-space>
    </n-card>

    <n-card title="缓存管理" size="small" style="margin-bottom: 16px">
      <n-space>
        <n-button type="warning" @click="handleClearCache" :loading="clearing">清除缓存</n-button>
      </n-space>
    </n-card>

    <!-- 定时任务 -->
    <n-card v-if="!isWorkerPlatform" size="small">
      <template #header>
        定时任务
        <n-tag size="small" type="warning" style="margin-left: 8px; vertical-align: middle">任务逻辑待实现</n-tag>
      </template>
      <template #header-extra>
        <n-button size="small" type="primary" @click="openTaskModal()">添加任务</n-button>
      </template>
      <n-spin :show="tasksLoading">
        <n-data-table v-if="tasks.length" :columns="taskColumns" :data="tasks" :bordered="false" size="small" :scroll-x="600" />
        <n-empty v-else-if="!tasksLoading" description="暂无定时任务" />
      </n-spin>
    </n-card>

    <!-- 添加/编辑任务 Modal -->
    <n-modal v-if="!isWorkerPlatform" v-model:show="showTaskModal" preset="dialog" :title="editingTaskId ? '编辑任务' : '添加任务'" style="width: 550px; max-width: 95vw">
      <n-form label-placement="left" label-width="100">
        <n-form-item label="任务名称">
          <n-input v-model:value="taskForm.name" placeholder="例如: 每日配额报告" />
        </n-form-item>
        <n-form-item label="任务类型">
          <n-select v-model:value="taskForm.type" :options="taskTypeOptions" @update:value="onTaskTypeChange" />
        </n-form-item>
        <n-text v-if="currentTypeDesc" depth="3" style="display: block; margin: -8px 0 12px 100px; font-size: 12px">{{ currentTypeDesc }}</n-text>

        <!-- 动态配置: 账号选择 -->
        <n-form-item v-if="taskNeedsAccount" label="账号">
          <n-select v-model:value="taskConfig.accountId" :options="accountOptions" placeholder="选择账号" />
        </n-form-item>

        <!-- KV 清理配置 -->
        <template v-if="taskForm.type === 'kv_cleanup'">
          <n-form-item label="命名空间 ID">
            <n-input v-model:value="taskConfig.namespaceId" placeholder="KV Namespace ID" />
          </n-form-item>
          <n-form-item label="Key 前缀">
            <n-input v-model:value="taskConfig.prefix" placeholder="仅清理指定前缀（可选）" />
          </n-form-item>
        </template>

        <!-- D1 备份配置 -->
        <template v-if="taskForm.type === 'd1_backup'">
          <n-form-item label="数据库 ID">
            <n-input v-model:value="taskConfig.databaseId" placeholder="D1 Database UUID" />
          </n-form-item>
        </template>

        <!-- R2 清理配置 -->
        <template v-if="taskForm.type === 'r2_cleanup'">
          <n-form-item label="存储桶">
            <n-input v-model:value="taskConfig.bucket" placeholder="Bucket 名称" />
          </n-form-item>
          <n-form-item label="最大保留天数">
            <n-input-number v-model:value="taskConfig.maxAgeDays" :min="1" :max="365" placeholder="30" />
          </n-form-item>
          <n-form-item label="前缀过滤">
            <n-input v-model:value="taskConfig.prefix" placeholder="仅清理指定前缀（可选）" />
          </n-form-item>
        </template>

        <n-form-item label="Cron 表达式">
          <n-input v-model:value="taskForm.cron" placeholder="例如: 0 8 * * *" />
        </n-form-item>
        <n-text depth="3" style="display: block; margin: -8px 0 0 100px; font-size: 12px">
          格式: 分 时 日 月 周 | 例: 0 8 * * * (每天8点), */30 * * * * (每30分钟), 0 0 * * 1 (每周一)
        </n-text>
      </n-form>
      <template #action>
        <n-button @click="showTaskModal = false">取消</n-button>
        <n-button type="primary" :loading="taskSaving" @click="handleSaveTask">保存</n-button>
      </template>
    </n-modal>

    <!-- Catalog Sources -->
    <n-card title="Catalog 源管理" size="small" style="margin-bottom: 16px">
      <template #header-extra>
        <n-button size="small" type="primary" @click="openAddSource">添加源</n-button>
      </template>
      <n-spin :show="sourceLoading">
        <n-list hoverable>
          <n-list-item v-for="s in catalogSources" :key="s.id">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%">
              <div>
                <n-space align="center">
                  <n-tag v-if="s.is_default" size="tiny" type="primary">默认</n-tag>
                  <n-tag :type="s.enabled ? 'success' : 'default'" size="tiny">{{ s.enabled ? '启用' : '禁用' }}</n-tag>
                  <span>{{ s.name }}</span>
                  <span style="color: var(--text-color-3); font-size: 12px">{{ s.url }}</span>
                </n-space>
                <div style="font-size: 12px; color: var(--text-color-3); margin-top: 4px">
                  <span v-if="s.last_status === 'ok'">✓ {{ s.last_synced }}</span>
                  <span v-else-if="s.last_status === 'error'" style="color: var(--error-color)">✗ {{ s.last_error }}</span>
                  <span v-else>待同步</span>
                </div>
              </div>
              <n-space>
                <n-button size="tiny" @click="toggleSource(s)">{{ s.enabled ? '禁用' : '启用' }}</n-button>
                <n-button v-if="!s.is_default" size="tiny" @click="openEditSource(s)">编辑</n-button>
                <n-button v-if="!s.is_default" size="tiny" type="error" quaternary @click="deleteSource(s)">删除</n-button>
              </n-space>
            </div>
          </n-list-item>
        </n-list>
        <n-empty v-if="!catalogSources.length && !sourceLoading" description="暂无源" />
      </n-spin>
    </n-card>

    <!-- Add Source Modal -->
    <n-modal v-model:show="showAddSource" preset="card" title="添加 Catalog 源" style="width: 400px; max-width: 95vw">
      <n-form label-placement="top" size="small">
        <n-form-item label="URL" required>
          <n-input-group>
            <n-input v-model:value="newSourceUrl" placeholder="https://..." clearable @keyup.enter="() => testSource(newSourceUrl)" />
            <n-button :loading="testingSource" :disabled="!newSourceUrl" @click="() => testSource(newSourceUrl)">测试</n-button>
          </n-input-group>
          <n-text v-if="sourceTestResult" :type="sourceTestResult.ok ? 'success' : 'error'" depth="3" style="font-size: 12px; display: block; margin-top: 4px">
            <template v-if="sourceTestResult.ok">✓ 可用，包含 {{ sourceTestResult.templateCount }} 个模板</template>
            <template v-else>✗ {{ sourceTestResult.error }}</template>
          </n-text>
        </n-form-item>
        <n-form-item label="别名" required>
          <n-input v-model:value="newSourceName" placeholder="如：社区源" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showAddSource = false">取消</n-button>
          <n-button type="primary" :loading="addingSource" :disabled="!sourceTestResult?.ok" @click="addSource">添加</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- Edit Source Modal -->
    <n-modal v-model:show="showEditSource" preset="card" title="编辑 Catalog 源" style="width: 400px; max-width: 95vw">
      <n-form label-placement="top" size="small">
        <n-form-item label="URL" required>
          <n-input-group>
            <n-input v-model:value="editSourceUrl" placeholder="https://..." clearable @keyup.enter="() => testSource(editSourceUrl)" />
            <n-button :loading="testingSource" :disabled="!editSourceUrl" @click="() => testSource(editSourceUrl)">测试</n-button>
          </n-input-group>
          <n-text v-if="sourceTestResult" :type="sourceTestResult.ok ? 'success' : 'error'" depth="3" style="font-size: 12px; display: block; margin-top: 4px">
            <template v-if="sourceTestResult.ok">✓ 可用，包含 {{ sourceTestResult.templateCount }} 个模板</template>
            <template v-else>✗ {{ sourceTestResult.error }}</template>
          </n-text>
        </n-form-item>
        <n-form-item label="别名" required>
          <n-input v-model:value="editSourceName" placeholder="如：社区源" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEditSource = false">取消</n-button>
          <n-button type="primary" :loading="editingSource" :disabled="!editCanSave" @click="saveEditSource">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 执行历史 Drawer -->
    <n-drawer v-if="!isWorkerPlatform" v-model:show="showHistoryDrawer" :width="drawerWidth(520)" placement="right">
      <n-drawer-content :title="`执行历史 - ${historyTaskName}`" closable>
        <n-spin :show="historyLoading">
          <n-timeline>
            <n-timeline-item v-for="h in taskHistory" :key="h.id" :type="h.status === 'success' ? 'success' : h.status === 'error' ? 'error' : 'info'" :title="h.status" :content="h.detail || '-'" :time="h.started_at ? formatCN(h.started_at) : '-'" />
          </n-timeline>
          <n-empty v-if="!taskHistory.length && !historyLoading" description="暂无执行记录" />
        </n-spin>
      </n-drawer-content>
    </n-drawer>

    <!-- 聚合首页 - 选择展示项目 Modal -->
    <n-modal v-model:show="showAggregateSelection" preset="card" title="选择展示项目" style="width: 820px; max-width: 95vw">
      <n-spin :show="aggregateLoadingWorkers">
        <div style="margin-bottom: 12px">
          <n-text depth="3" style="font-size: 12px">
            勾选要展示在公开作品集首页的 Workers + Pages 项目。勾选后可拖拽排序 (↑↓),
            排序结果即为首页展示顺序。自定义域名将自动作为链接 (优先于 workers.dev / pages.dev)。
          </n-text>
        </div>
        <div v-for="group in aggregateWorkersByAccount" :key="group.account_id" style="margin-bottom: 16px">
          <n-divider title-placement="left" style="margin: 8px 0">
            <n-space :size="4" align="center">
              <n-icon :component="PeopleOutline" :size="14" />
              <span style="font-size: 13px">{{ group.account_name }}</span>
              <n-tag size="tiny" round>{{ group.workers.length }} 个项目</n-tag>
            </n-space>
          </n-divider>
          <div class="agg-select-list">
            <div
              v-for="w in group.workers"
              :key="`${group.account_id}-${w.name}`"
              :class="['agg-select-item', { 'agg-select-item--selected': isAggregateItemSelected(group.account_id, w.name) }]"
            >
              <div class="agg-select-item__main">
                <n-checkbox
                  :checked="isAggregateItemSelected(group.account_id, w.name)"
                  @update:checked="(v: boolean) => toggleAggregateItem(group.account_id, w.name, w.type, v)"
                />
                <div class="agg-select-item__info">
                  <div class="agg-select-item__name">
                    <n-icon :component="w.type === 'pages' ? DocumentTextOutline : CubeOutline" :size="14" />
                    <span>{{ w.name }}</span>
                    <n-tag size="tiny" :bordered="false" :type="w.type === 'pages' ? 'info' : 'success'">{{ w.type }}</n-tag>
                  </div>
                  <div class="agg-select-item__domain">
                    {{ (w.domains && w.domains[0]) || (w.type === 'pages' ? `${w.name}.pages.dev` : `${w.name}.workers.dev`) }}
                  </div>
                </div>
              </div>
              <div class="agg-select-item__actions" v-if="isAggregateItemSelected(group.account_id, w.name)">
                <n-button size="tiny" quaternary @click="moveAggregateItem(group.account_id, w.name, -1)">↑</n-button>
                <n-button size="tiny" quaternary @click="moveAggregateItem(group.account_id, w.name, 1)">↓</n-button>
                <n-input
                  size="tiny"
                  :value="getAggregateDisplayName(group.account_id, w.name)"
                  @update:value="(v: string) => setAggregateDisplayName(group.account_id, w.name, v)"
                  placeholder="自定义展示名"
                  style="width: 140px"
                />
              </div>
            </div>
          </div>
        </div>
        <n-empty v-if="aggregateWorkersByAccount.length === 0 && !aggregateLoadingWorkers" description="暂无 Workers + Pages 项目, 请先在「账号管理」添加 Cloudflare 账号" />
      </n-spin>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showAggregateSelection = false">关闭</n-button>
          <n-button type="primary" :loading="aggregateSaving" @click="saveAggregateSelection">保存选择</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 聚合首页 - 主题风格 Modal -->
    <n-modal v-model:show="showAggregateStyle" preset="card" title="主题风格" style="width: 620px; max-width: 95vw">
      <n-space vertical>
        <div>
          <n-text style="font-weight: 500">标题</n-text>
          <n-input v-model:value="aggregateStyleForm.title" placeholder="如 我的作品集 / Projects" style="margin-top: 4px" />
        </div>
        <div>
          <n-text style="font-weight: 500">副标题</n-text>
          <n-input v-model:value="aggregateStyleForm.subtitle" placeholder="如 Projects & Demos" style="margin-top: 4px" />
        </div>
        <div>
          <n-text style="font-weight: 500">主题风格</n-text>
          <div class="theme-preview-grid" style="margin-top: 8px">
            <button
              :class="['theme-preview-card', { 'theme-preview-card--active': aggregateStyleForm.theme === 'default' }]"
              @click="aggregateStyleForm.theme = 'default'"
            >
              <div class="theme-preview-card__preview theme-preview-card__preview--default">
                <div class="theme-preview-card__bar" style="background: linear-gradient(135deg, #18a058, #36ad6a)"></div>
                <div class="theme-preview-card__bar" style="background: #f0f0f0; height: 6px"></div>
                <div class="theme-preview-card__bar" style="background: #f0f0f0; height: 6px; width: 60%"></div>
              </div>
              <div class="theme-preview-card__label">默认 (绿色卡片)</div>
            </button>
            <button
              :class="['theme-preview-card', { 'theme-preview-card--active': aggregateStyleForm.theme === 'brutalism' }]"
              @click="aggregateStyleForm.theme = 'brutalism'"
            >
              <div class="theme-preview-card__preview theme-preview-card__preview--brutalism">
                <div class="theme-preview-card__bar" style="background: #000; height: 12px; border: 2px solid #000"></div>
                <div class="theme-preview-card__bar" style="background: #fff; height: 8px; border: 2px solid #000"></div>
                <div class="theme-preview-card__bar" style="background: #ffe500; height: 8px; border: 2px solid #000; width: 60%"></div>
              </div>
              <div class="theme-preview-card__label">新粗野主义 (黑白+黄色)</div>
            </button>
          </div>
          <n-text depth="3" style="font-size: 12px; display: block; margin-top: 8px">
            💡 两种风格均不含紫色系配色。新粗野主义使用粗黑边框 + 高饱和黄色/黑色色块。
          </n-text>
        </div>
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showAggregateStyle = false">取消</n-button>
          <n-button type="primary" :loading="aggregateSaving" @click="saveAggregateStyle">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, h, onMounted } from 'vue';
import { NButton, NSpace, NTag, NSwitch, NIcon, NCheckbox, NAlert, NDivider, useMessage } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { PeopleOutline, CubeOutline, DocumentTextOutline } from '@vicons/ionicons5';
import { settingsApi } from '../api/settings';
import { tasksApi } from '../api/storage';
import apiClient from '../api/client';
import { useAccountStore } from '../stores/accountStore';
import { formatCN } from '../utils/dateFormat';
import { storeApi } from '../api/store';

const message = useMessage();

function drawerWidth(desktopWidth: number): number {
  return window.innerWidth <= 768 ? Math.min(window.innerWidth, desktopWidth) : desktopWidth;
}
const accountStore = useAccountStore();
const loading = ref(false);
const clearing = ref(false);
const settings = ref<any>({});
const proxyUrl = ref('');
const proxyEnabled = ref(false);
const proxySaving = ref(false);
const proxyTesting = ref(false);
const proxyToggling = ref(false);

const isWorkerPlatform = computed(() => settings.value.platform === 'cloudflare-workers');

async function fetchSettings() {
  loading.value = true;
  try {
    const { data } = await settingsApi.get();
    settings.value = data;
    proxyUrl.value = data.proxy_url || '';
    proxyEnabled.value = !!data.proxy_enabled;
    baseUrlInput.value = data.base_url || '/';
  } catch {
    settings.value = {};
  } finally {
    loading.value = false;
  }
}

async function toggleProxy(enabled: boolean) {
  proxyToggling.value = true;
  try {
    const { data } = await apiClient.put('/settings/proxy', { proxy_enabled: enabled });
    proxyEnabled.value = !!data.proxy_enabled;
    message.success(enabled ? '代理已启用' : '代理已关闭');
  } catch {
    message.error('切换代理失败');
  } finally {
    proxyToggling.value = false;
  }
}

async function saveProxy() {
  proxySaving.value = true;
  try {
    const { data } = await apiClient.put('/settings/proxy', { proxy_url: proxyUrl.value });
    proxyEnabled.value = !!data.proxy_enabled;
    message.success('代理设置已保存');
  } catch {
    message.error('保存代理设置失败');
  } finally {
    proxySaving.value = false;
  }
}

async function testProxy() {
  if (!proxyUrl.value) return;
  proxyTesting.value = true;
  try {
    const { data } = await settingsApi.testProxy(proxyUrl.value);
    message.success(`代理可用！延迟 ${data.latency_ms}ms，HTTP ${data.status}`);
  } catch (err: any) {
    const msg = err?.response?.data?.error?.message || err?.message || '连接失败';
    message.error(`代理不可用：${msg}`);
  } finally {
    proxyTesting.value = false;
  }
}

async function handleClearCache() {
  clearing.value = true;
  try {
    await settingsApi.clearCache();
    message.success('缓存已清除');
  } finally {
    clearing.value = false;
  }
}

// ============ baseURL config ============
const baseUrlInput = ref('/');
const baseUrlSaving = ref(false);

async function saveBaseUrl() {
  if (!baseUrlInput.value) baseUrlInput.value = '/';
  baseUrlSaving.value = true;
  try {
    const { data } = await apiClient.put('/settings/base-url', { base_url: baseUrlInput.value });
    message.success(data.message || 'BASE_URL 已保存, 请重启后端生效');
    await fetchSettings();
  } catch (err: any) {
    const msg = err?.response?.data?.error?.message || err?.message || '保存失败';
    message.error(msg);
  } finally {
    baseUrlSaving.value = false;
  }
}

// ============ Aggregate homepage config ============
interface AggregateItem {
  account_id: number;
  worker_name: string;
  type: 'worker' | 'pages';
  display_name: string;
  sort_order: number;
  custom_url?: string;
}
interface AggregateConfig {
  enabled: boolean;
  theme: 'default' | 'brutalism';
  title: string;
  subtitle: string;
  items: AggregateItem[];
}
const aggregateConfig = ref<AggregateConfig>({
  enabled: false, theme: 'default', title: '作品集', subtitle: 'Projects & Demos', items: [],
});
const aggregateSaving = ref(false);
const showAggregateSelection = ref(false);
const showAggregateStyle = ref(false);
const aggregateLoadingWorkers = ref(false);
// All Workers + Pages grouped by account (loaded when the selection modal opens)
const aggregateWorkersByAccount = ref<Array<{ account_id: number; account_name: string; workers: Array<{ name: string; type: 'worker' | 'pages'; domains: string[] }> }>>([]);
// Local working copy of selected items while the selection modal is open
const aggregateSelectionDraft = ref<AggregateItem[]>([]);
const aggregateStyleForm = ref<{ title: string; subtitle: string; theme: 'default' | 'brutalism' }>({
  title: '作品集', subtitle: 'Projects & Demos', theme: 'default',
});

async function fetchAggregateConfig() {
  try {
    const { data } = await apiClient.get('/settings/aggregate-homepage');
    aggregateConfig.value = {
      enabled: !!data.enabled,
      theme: data.theme === 'brutalism' ? 'brutalism' : 'default',
      title: data.title || '作品集',
      subtitle: data.subtitle || 'Projects & Demos',
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch {
    // Use defaults
  }
}

async function toggleAggregateHomepage(enabled: boolean) {
  aggregateSaving.value = true;
  try {
    const { data } = await apiClient.put('/settings/aggregate-homepage', { enabled });
    aggregateConfig.value = data.config;
    message.success(enabled ? '聚合首页已启用, 访问 / 查看效果' : '聚合首页已关闭, / 将跳转后台');
  } catch (err: any) {
    message.error(err?.errorMessage || '切换失败');
  } finally {
    aggregateSaving.value = false;
  }
}

async function openAggregateSelectionModal() {
  showAggregateSelection.value = true;
  // Clone the current config items into a working draft
  aggregateSelectionDraft.value = aggregateConfig.value.items.map(it => ({ ...it }));
  // Load all Workers + Pages grouped by account
  aggregateLoadingWorkers.value = true;
  try {
    const { data } = await apiClient.get('/workers');
    const all = Array.isArray(data) ? data : [];
    // Group by account_id
    const groupMap = new Map<number, { account_id: number; account_name: string; workers: Array<{ name: string; type: 'worker' | 'pages'; domains: string[] }> }>();
    for (const w of all) {
      const aid = w.cfAccountId || w.account_id;
      if (!groupMap.has(aid)) {
        groupMap.set(aid, { account_id: aid, account_name: w.accountName || `账号 ${aid}`, workers: [] });
      }
      groupMap.get(aid)!.workers.push({
        name: w.name,
        type: w.type === 'pages' ? 'pages' : 'worker',
        domains: w.domains || [],
      });
    }
    aggregateWorkersByAccount.value = Array.from(groupMap.values());
  } catch (err: any) {
    message.error(err?.errorMessage || '加载 Workers + Pages 失败');
    aggregateWorkersByAccount.value = [];
  } finally {
    aggregateLoadingWorkers.value = false;
  }
}

function isAggregateItemSelected(accountId: number, workerName: string): boolean {
  return aggregateSelectionDraft.value.some(it => it.account_id === accountId && it.worker_name === workerName);
}

function toggleAggregateItem(accountId: number, workerName: string, type: 'worker' | 'pages', checked: boolean) {
  if (checked) {
    if (!isAggregateItemSelected(accountId, workerName)) {
      aggregateSelectionDraft.value.push({
        account_id: accountId,
        worker_name: workerName,
        type,
        display_name: workerName,
        sort_order: aggregateSelectionDraft.value.length,
      });
    }
  } else {
    aggregateSelectionDraft.value = aggregateSelectionDraft.value.filter(it => !(it.account_id === accountId && it.worker_name === workerName));
    // Re-index sort_order
    aggregateSelectionDraft.value.forEach((it, idx) => { it.sort_order = idx; });
  }
}

function moveAggregateItem(accountId: number, workerName: string, direction: -1 | 1) {
  const idx = aggregateSelectionDraft.value.findIndex(it => it.account_id === accountId && it.worker_name === workerName);
  if (idx < 0) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= aggregateSelectionDraft.value.length) return;
  const tmp = aggregateSelectionDraft.value[idx];
  aggregateSelectionDraft.value[idx] = aggregateSelectionDraft.value[newIdx];
  aggregateSelectionDraft.value[newIdx] = tmp;
  // Re-index sort_order
  aggregateSelectionDraft.value.forEach((it, i) => { it.sort_order = i; });
}

function getAggregateDisplayName(accountId: number, workerName: string): string {
  const it = aggregateSelectionDraft.value.find(x => x.account_id === accountId && x.worker_name === workerName);
  return it?.display_name || workerName;
}

function setAggregateDisplayName(accountId: number, workerName: string, value: string) {
  const it = aggregateSelectionDraft.value.find(x => x.account_id === accountId && x.worker_name === workerName);
  if (it) it.display_name = value || workerName;
}

async function saveAggregateSelection() {
  aggregateSaving.value = true;
  try {
    const { data } = await apiClient.put('/settings/aggregate-homepage', { items: aggregateSelectionDraft.value });
    aggregateConfig.value = data.config;
    message.success(`已保存 ${aggregateSelectionDraft.value.length} 个展示项目`);
    showAggregateSelection.value = false;
  } catch (err: any) {
    message.error(err?.errorMessage || '保存失败');
  } finally {
    aggregateSaving.value = false;
  }
}

function openAggregateStyleModal() {
  aggregateStyleForm.value = {
    title: aggregateConfig.value.title,
    subtitle: aggregateConfig.value.subtitle,
    theme: aggregateConfig.value.theme,
  };
  showAggregateStyle.value = true;
}

async function saveAggregateStyle() {
  aggregateSaving.value = true;
  try {
    const { data } = await apiClient.put('/settings/aggregate-homepage', {
      title: aggregateStyleForm.value.title,
      subtitle: aggregateStyleForm.value.subtitle,
      theme: aggregateStyleForm.value.theme,
    });
    aggregateConfig.value = data.config;
    message.success('主题风格已保存');
    showAggregateStyle.value = false;
  } catch (err: any) {
    message.error(err?.errorMessage || '保存失败');
  } finally {
    aggregateSaving.value = false;
  }
}

// ============ Tasks ============
const tasks = ref<any[]>([]);
const tasksLoading = ref(false);
const showTaskModal = ref(false);
const editingTaskId = ref<number | null>(null);
const taskForm = ref({ name: '', type: 'quota_report', cron: '0 8 * * *' });
const taskConfig = ref<any>({ accountId: null, namespaceId: '', databaseId: '', bucket: '', maxAgeDays: 30, prefix: '' });
const taskSaving = ref(false);
const showHistoryDrawer = ref(false);
const historyTaskName = ref('');
const taskHistory = ref<any[]>([]);
const historyLoading = ref(false);

const taskTypeOptions = [
  { label: '配额使用报告（未实现）', value: 'quota_report' },
  { label: 'KV 过期清理（未实现）', value: 'kv_cleanup' },
  { label: 'D1 数据库备份（未实现）', value: 'd1_backup' },
  { label: 'R2 过期文件清理（未实现）', value: 'r2_cleanup' },
];

const taskTypeDescMap: Record<string, string> = {
  quota_report: '[未实现] 定期检查 Workers / Pages 的请求量配额，生成使用报告',
  kv_cleanup: '[未实现] 清理指定 KV 命名空间中过期或指定前缀的 key',
  d1_backup: '[未实现] 对指定 D1 数据库执行导出备份',
  r2_cleanup: '[未实现] 删除指定 R2 存储桶中超过保留天数的文件',
};

const currentTypeDesc = computed(() => taskTypeDescMap[taskForm.value.type] || '');
const taskNeedsAccount = computed(() => ['kv_cleanup', 'd1_backup', 'r2_cleanup'].includes(taskForm.value.type));

const accountOptions = computed(() =>
  accountStore.accounts.filter((a: any) => a.is_active).map((a: any) => ({ label: a.name, value: a.id }))
);

function onTaskTypeChange() {
  taskConfig.value = { accountId: accountOptions.value[0]?.value || null, namespaceId: '', databaseId: '', bucket: '', maxAgeDays: 30, prefix: '' };
}

async function fetchTasks() {
  tasksLoading.value = true;
  try {
    const { data } = await tasksApi.getAll();
    tasks.value = Array.isArray(data) ? data : [];
  } catch {
    tasks.value = [];
  } finally {
    tasksLoading.value = false;
  }
}

function openTaskModal(task?: any) {
  if (task) {
    editingTaskId.value = task.id;
    taskForm.value = { name: task.name, type: task.type, cron: task.cron };
    const parsed = task.config ? (typeof task.config === 'string' ? JSON.parse(task.config) : task.config) : {};
    taskConfig.value = {
      accountId: parsed.accountId || accountOptions.value[0]?.value || null,
      namespaceId: parsed.namespaceId || '',
      databaseId: parsed.databaseId || '',
      bucket: parsed.bucket || '',
      maxAgeDays: parsed.maxAgeDays || 30,
      prefix: parsed.prefix || '',
    };
  } else {
    editingTaskId.value = null;
    taskForm.value = { name: '', type: 'quota_report', cron: '0 8 * * *' };
    taskConfig.value = { accountId: accountOptions.value[0]?.value || null, namespaceId: '', databaseId: '', bucket: '', maxAgeDays: 30, prefix: '' };
  }
  showTaskModal.value = true;
}

async function handleSaveTask() {
  if (!taskForm.value.name || !taskForm.value.cron) {
    message.warning('请填写完整信息');
    return;
  }
  taskSaving.value = true;
  try {
    const payload = { ...taskForm.value, config: taskNeedsAccount.value ? taskConfig.value : undefined };
    if (editingTaskId.value) {
      await tasksApi.update(editingTaskId.value, payload);
      message.success('任务已更新');
    } else {
      await tasksApi.create(payload);
      message.success('任务已创建');
    }
    showTaskModal.value = false;
    fetchTasks();
  } finally {
    taskSaving.value = false;
  }
}

async function handleDeleteTask(row: any) {
  await tasksApi.delete(row.id);
  message.success('任务已删除');
  fetchTasks();
}

async function handleRunTask(row: any) {
  await tasksApi.run(row.id);
  message.success('任务已执行');
}

async function handleToggleTask(row: any, enabled: boolean) {
  await tasksApi.update(row.id, { enabled });
  row.enabled = enabled ? 1 : 0;
}

async function openHistory(row: any) {
  historyTaskName.value = row.name;
  showHistoryDrawer.value = true;
  historyLoading.value = true;
  try {
    const { data } = await tasksApi.getHistory(row.id);
    taskHistory.value = Array.isArray(data) ? data : [];
  } catch {
    taskHistory.value = [];
  } finally {
    historyLoading.value = false;
  }
}

const taskColumns: DataTableColumns<any> = [
  { title: '名称', key: 'name', minWidth: 120 },
  { title: '类型', key: 'type', width: 120, render: (row) => h(NTag, { size: 'small' }, { default: () => taskTypeOptions.find(o => o.value === row.type)?.label || row.type }) },
  { title: 'Cron', key: 'cron', width: 140 },
  { title: '启用', key: 'enabled', width: 80, render: (row) => h(NSwitch, { value: !!row.enabled, onUpdateValue: (v: boolean) => handleToggleTask(row, v) }) },
  {
    title: '操作', key: 'actions', width: 220,
    render: (row) => h(NSpace, null, { default: () => [
      h(NButton, { size: 'small', onClick: () => handleRunTask(row) }, { default: () => '执行' }),
      h(NButton, { size: 'small', onClick: () => openHistory(row) }, { default: () => '历史' }),
      h(NButton, { size: 'small', onClick: () => openTaskModal(row) }, { default: () => '编辑' }),
      h(NButton, { size: 'small', type: 'error', onClick: () => handleDeleteTask(row) }, { default: () => '删除' }),
    ]}),
  },
];

// ============ Catalog Sources ============
const sourceLoading = ref(false);
const catalogSources = ref<any[]>([]);
const showAddSource = ref(false);
const newSourceUrl = ref('');
const newSourceName = ref('');
const addingSource = ref(false);
const testingSource = ref(false);
const sourceTestResult = ref<{ ok: boolean; templateCount?: number; error?: string } | null>(null);

// Edit source state
const showEditSource = ref(false);
const editingSource = ref(false);
const editSourceId = ref<number | null>(null);
const editSourceUrl = ref('');
const editSourceName = ref('');
const editSourceOriginalUrl = ref('');

const editUrlChanged = computed(() => editSourceUrl.value !== editSourceOriginalUrl.value);
const editCanSave = computed(() =>
  !!editSourceName.value && (!editUrlChanged.value || !!sourceTestResult.value?.ok) && !editingSource.value
);

async function loadSources() {
  sourceLoading.value = true;
  try {
    const { data } = await storeApi.getSources();
    catalogSources.value = data as any[];
  } catch {} finally {
    sourceLoading.value = false;
  }
}

function openAddSource() {
  showAddSource.value = true;
  newSourceUrl.value = '';
  newSourceName.value = '';
  sourceTestResult.value = null;
}

function openEditSource(s: any) {
  showEditSource.value = true;
  editSourceId.value = s.id;
  editSourceUrl.value = s.url;
  editSourceOriginalUrl.value = s.url;
  editSourceName.value = s.name;
  sourceTestResult.value = null;
}

async function testSource(targetUrl: string) {
  if (!targetUrl) return;
  testingSource.value = true;
  sourceTestResult.value = null;
  try {
    const { data } = await storeApi.testSource(targetUrl);
    sourceTestResult.value = data;
    if (data.ok) message.success(`可用，包含 ${data.templateCount} 个模板`);
    else message.error(`测试失败：${data.error}`);
  } catch (err: any) {
    const msg = err?.response?.data?.error || err?.message || '测试失败';
    sourceTestResult.value = { ok: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg) };
    message.error(`测试失败：${sourceTestResult.value.error}`);
  } finally {
    testingSource.value = false;
  }
}

async function addSource() {
  if (!newSourceUrl.value || !newSourceName.value) return;
  addingSource.value = true;
  try {
    await storeApi.addSource(newSourceUrl.value, newSourceName.value);
    message.success('添加成功');
    showAddSource.value = false;
    newSourceUrl.value = '';
    newSourceName.value = '';
    sourceTestResult.value = null;
    await loadSources();
  } catch {} finally {
    addingSource.value = false;
  }
}

async function saveEditSource() {
  if (editSourceId.value == null) return;
  editingSource.value = true;
  try {
    await storeApi.updateSource(editSourceId.value, { url: editSourceUrl.value, name: editSourceName.value });
    message.success('已保存');
    showEditSource.value = false;
    sourceTestResult.value = null;
    await loadSources();
  } catch {} finally {
    editingSource.value = false;
  }
}

async function toggleSource(s: any) {
  try {
    await storeApi.updateSource(s.id, { enabled: s.enabled ? 0 : 1 });
    await loadSources();
  } catch {}
}

async function deleteSource(s: any) {
  try {
    await storeApi.deleteSource(s.id);
    message.success('已删除');
    await loadSources();
  } catch {}
}

onMounted(async () => {
  await fetchSettings();
  fetchAggregateConfig();
  if (!isWorkerPlatform.value) {
    fetchTasks();
  }
  accountStore.fetchAccounts();
  loadSources();
});
</script>

<style scoped>
.agg-select-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.agg-select-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--n-border-color, #eee);
  border-radius: 6px;
  background: var(--n-color, #fff);
  transition: all 0.15s ease;
}
.agg-select-item--selected {
  border-color: #18a058;
  background: rgba(24, 160, 88, 0.04);
}
.agg-select-item__main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.agg-select-item__info {
  min-width: 0;
}
.agg-select-item__name {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--n-text-color, #333);
}
.agg-select-item__domain {
  font-size: 11px;
  color: var(--n-text-color-3, #999);
  margin-top: 2px;
  font-family: monospace;
}
.agg-select-item__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Theme preview cards */
.theme-preview-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.theme-preview-card {
  text-align: left;
  padding: 0;
  border: 2px solid var(--n-border-color, #ddd);
  border-radius: 8px;
  background: var(--n-color, #fff);
  cursor: pointer;
  transition: all 0.15s ease;
  overflow: hidden;
}
.theme-preview-card:hover {
  border-color: #18a058;
}
.theme-preview-card--active {
  border-color: #18a058;
  box-shadow: 0 0 0 2px rgba(24, 160, 88, 0.2);
}
.theme-preview-card__preview {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: 80px;
}
.theme-preview-card__preview--default {
  background: linear-gradient(135deg, #f8fef9, #fff);
}
.theme-preview-card__preview--brutalism {
  background: #fff;
  border-bottom: 2px solid #000;
}
.theme-preview-card__bar {
  border-radius: 3px;
}
.theme-preview-card__label {
  padding: 6px 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--n-text-color, #555);
  background: var(--n-card-color, #fafafa);
  border-top: 1px solid var(--n-border-color, #eee);
}
</style>
