<template>
  <div class="page-view">
    <!-- 标题 + 操作 -->
    <n-space justify="space-between" align="center" :wrap="true">
      <n-space align="center">
        <n-h2 style="margin: 0">Pages聚合</n-h2>
        <n-tag size="small" type="info" round>跨账户</n-tag>
      </n-space>
      <n-space>
        <n-select
          v-model:value="groupByAccount"
          :options="groupByOptions"
          style="width: 140px"
          size="small"
        />
        <n-button size="small" @click="loadDetailed" :loading="loadingDetailed" :disabled="loading">
          加载自定义域名
        </n-button>
        <n-button size="small" type="primary" @click="load" :loading="loading">刷新</n-button>
      </n-space>
    </n-space>

    <!-- 统计摘要 -->
    <n-grid cols="1 s:2 m:4 l:4" :x-gap="8" :y-gap="8" responsive="screen" v-if="!loading && summary">
      <n-gi>
        <n-card size="small" :bordered="false" class="stat-card">
          <n-statistic label="Pages 项目总数" :value="summary.total_projects" />
        </n-card>
      </n-gi>
      <n-gi>
        <n-card size="small" :bordered="false" class="stat-card">
          <n-statistic label="账户总数">
            <template #default>{{ summary.total_accounts }}</template>
            <template #suffix>
              <n-text depth="3" style="font-size: 12px; margin-left: 6px">
                ({{ summary.healthy_accounts }} 正常)
              </n-text>
            </template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi>
        <n-card size="small" :bordered="false" class="stat-card">
          <n-statistic label="入口域名总数" :value="entryDomainCount" />
        </n-card>
      </n-gi>
      <n-gi>
        <n-card size="small" :bordered="false" class="stat-card">
          <n-statistic label="异常账户" :value="summary.failed_accounts.length">
            <template #suffix>
              <n-text v-if="summary.failed_accounts.length === 0" depth="3" style="font-size: 12px; margin-left: 6px">
                全部健康
              </n-text>
              <n-text v-else type="error" style="font-size: 12px; margin-left: 6px">
                需检查
              </n-text>
            </template>
          </n-statistic>
        </n-card>
      </n-gi>
    </n-grid>

    <!-- 筛选条 -->
    <n-space :wrap="true" align="center">
      <n-input
        v-model:value="searchText"
        placeholder="搜索项目名 / 域名 / 账户名..."
        clearable
        size="small"
        style="width: 260px"
      >
        <template #prefix>
          <n-icon :component="SearchOutline" />
        </template>
      </n-input>
      <n-select
        v-model:value="filterAccountId"
        :options="accountOptions"
        placeholder="按账户筛选"
        clearable
        filterable
        size="small"
        style="width: 220px"
      />
      <n-select
        v-model:value="sortBy"
        :options="sortOptions"
        size="small"
        style="width: 160px"
      />
      <n-tag v-if="filteredProjects.length !== projects.length" size="small" type="info">
        {{ filteredProjects.length }} / {{ projects.length }} 个项目
      </n-tag>
    </n-space>

    <!-- 异常账户提醒 -->
    <n-alert
      v-if="!loading && summary && decryptFailed.length > 0"
      type="error"
      title="部分账户凭证无法解密"
      style="margin: 0"
    >
      <div style="display: flex; flex-direction: column; gap: 8px">
        <div>
          以下账户的 API 凭证是用与当前 <code>ENCRYPTION_KEY</code> 不同的密钥加密的
          （常见于 <code>.env</code> 重新生成或数据库迁移后）。点击「重置凭证」会清空这些账户的加密字段
          （账户名、邮箱、account_id 等元数据会保留），随后请在「账号管理」里重新录入 API 凭证。
        </div>
        <n-space :size="6" :wrap="true">
          <n-tag
            v-for="f in decryptFailed"
            :key="f.account_id"
            type="error"
            size="small"
          >
            {{ f.account_name }}
          </n-tag>
          <n-button
            size="small"
            type="error"
            :loading="resetting"
            @click="resetBrokenCredentials"
          >
            重置凭证
          </n-button>
        </n-space>
      </div>
    </n-alert>

    <n-alert
      v-if="!loading && summary && apiFailed.length > 0"
      type="warning"
      title="部分账户拉取失败"
      closable
      style="margin: 0"
    >
      <n-space :size="6" :wrap="true">
        <n-tag
          v-for="f in apiFailed"
          :key="f.account_id"
          type="warning"
          size="small"
        >
          {{ f.account_name }}: {{ f.error }}
        </n-tag>
      </n-space>
    </n-alert>

    <!-- 主体内容 -->
    <n-spin :show="loading">
      <!-- 平铺展示 -->
      <div v-if="!groupByAccount" class="card-grid-scroll">
        <n-grid
          v-if="filteredProjects.length > 0"
          cols="1 s:2 m:3 l:4 xl:5"
          :x-gap="10"
          :y-gap="10"
          responsive="screen"
          item-responsive
          style="width: 100%;height: 100%;align-items: start;"
        >
          <n-gi v-for="p in filteredProjects" :key="`${p.account_id}-${p.id}`" style="height: 100%;box-sizing: border-box;">
            <div class="pages-card">
              <div class="pages-card__head">
                <div class="pages-card__title-row">
                  <n-icon :component="RocketOutline" :size="18" color="#18a058" />
                  <span class="pages-card__name" :title="p.name">{{ p.name }}</span>
                </div>
                <n-tag size="tiny" type="info" round :bordered="false">{{ p.account_name }}</n-tag>
              </div>
              <div class="pages-card__body">
                <div class="pages-card__row">
                  <span class="pages-card__label">入口域名</span>
                  <div class="pages-card__domains">
                    <n-button
                      v-for="d in (p.domains || [`${p.name}.pages.dev`]).slice(0, 5).reverse()"
                      :key="d"
                      size="tiny"
                      text
                      type="primary"
                      @click="openEntry(d)"
                      class="w-full !justify-start"
                    >
                      <span class="pages-card__domain">
                        <n-icon :component="GlobeOutline" :size="12" />
                        <span class="pages-card__domain-text" :title="d">{{ d }}</span>
                      </span>
                    </n-button>
                  </div>
                </div>
                <div class="pages-card__row">
                  <span class="pages-card__label">生产分支</span>
                  <span class="pages-card__value">{{ p.production_branch || '-' }}</span>
                </div>
                <div class="pages-card__row">
                  <span class="pages-card__label">部署次数</span>
                  <span class="pages-card__value">{{ p.deployment_count ?? 0 }}</span>
                </div>
                <div class="pages-card__row">
                  <span class="pages-card__label">最近更新</span>
                  <span class="pages-card__value">{{ formatCNShort(p.modified_on || p.created_on) }}</span>
                </div>
              </div>
              <div class="pages-card__footer">
                <n-space :size="4" align="center">
                  <n-tag size="tiny" :bordered="false" type="success">{{ (p.domains || []).length }} 域名</n-tag>
                  <n-tag v-if="p.source?.type" size="tiny" :bordered="false">{{ p.source.type }}</n-tag>
                </n-space>
                <n-button
                  size="small"
                  type="primary"
                  tertiary
                  @click="openEntry((p.domains && p.domains[0]) || `${p.name}.pages.dev`)"
                >
                  <template #icon><n-icon :component="OpenOutline" /></template>
                  访问
                </n-button>
              </div>
            </div>
          </n-gi>
        </n-grid>
        <n-empty v-else description="暂无 Pages 项目，可在「账号管理」添加 Cloudflare 账号后查看" style="padding: 60px 0" />
      </div>

      <!-- 按账户分组展示 -->
      <div v-else class="card-grid-scroll">
        <div
          v-for="grp in groupedProjects"
          :key="grp.account_id"
          style="margin-bottom: 16px"
        >
          <n-divider title-placement="left" style="margin: 8px 0">
            <n-space :size="6" align="center">
              <n-icon :component="PeopleOutline" />
              <span>{{ grp.account_name }}</span>
              <n-tag size="tiny" round>{{ grp.projects.length }} 个项目</n-tag>
              <n-tag v-if="grp.error" size="tiny" type="error">拉取失败</n-tag>
            </n-space>
          </n-divider>
          <n-grid
            v-if="grp.projects.length > 0"
            cols="1 s:2 m:3 l:4 xl:5"
            :x-gap="10"
            :y-gap="10"
            responsive="screen"
            item-responsive
            style="width: 100%"
          >
            <n-gi v-for="p in grp.projects" :key="`${p.account_id}-${p.id}`">
              <div class="pages-card">
                <div class="pages-card__head">
                  <div class="pages-card__title-row">
                    <n-icon :component="RocketOutline" :size="18" color="#18a058" />
                    <span class="pages-card__name" :title="p.name">{{ p.name }}</span>
                  </div>
                </div>
                <div class="pages-card__body">
                  <div class="pages-card__row">
                    <span class="pages-card__label">入口域名</span>
                    <div class="pages-card__domains">
                      <n-button
                        v-for="d in (p.domains || [`${p.name}.pages.dev`]).slice(0, 5).reverse()"
                        :key="d"
                        size="tiny"
                        text
                        type="primary"
                        @click="openEntry(d)"
                        class="block"
                      >
                        <span class="pages-card__domain">
                          <n-icon :component="GlobeOutline" :size="12" />
                          <span class="pages-card__domain-text" :title="d">{{ d }}</span>
                        </span>
                      </n-button>
                    </div>
                  </div>
                  <div class="pages-card__row">
                    <span class="pages-card__label">生产分支</span>
                    <span class="pages-card__value">{{ p.production_branch || '-' }}</span>
                  </div>
                  <div class="pages-card__row">
                    <span class="pages-card__label">部署次数</span>
                    <span class="pages-card__value">{{ p.deployment_count ?? 0 }}</span>
                  </div>
                  <div class="pages-card__row">
                    <span class="pages-card__label">最近更新</span>
                    <span class="pages-card__value">{{ formatCNShort(p.modified_on || p.created_on) }}</span>
                  </div>
                </div>
                <div class="pages-card__footer">
                  <n-tag size="tiny" :bordered="false" type="success">{{ (p.domains || []).length }} 域名</n-tag>
                  <n-button
                    size="small"
                    type="primary"
                    tertiary
                    @click="openEntry((p.domains && p.domains[0]) || `${p.name}.pages.dev`)"
                  >
                    <template #icon><n-icon :component="OpenOutline" /></template>
                    访问
                  </n-button>
                </div>
              </div>
            </n-gi>
          </n-grid>
          <n-empty
            v-else-if="grp.error"
            description="该账户 Pages 拉取失败，请检查 API 凭证或网络"
            style="padding: 20px 0"
            size="small"
          />
        </div>
        <n-empty
          v-if="groupedProjects.length === 0"
          description="暂无 Pages 项目"
          style="padding: 60px 0"
        />
      </div>
    </n-spin>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  SearchOutline, PeopleOutline, GlobeOutline, OpenOutline, RocketOutline, LinkOutline,
} from '@vicons/ionicons5';
import { useMessage } from 'naive-ui';
import { pagesAggregatorApi, type AggregatedPageProject, type PagesAggregatorResponse } from '../api/pagesAggregator';
import apiClient from '../api/client';
import { formatCNShort } from '../utils/dateFormat';

const message = useMessage();

const loading = ref(false);
const loadingDetailed = ref(false);
const resetting = ref(false);
const summary = ref<PagesAggregatorResponse | null>(null);
const projects = ref<AggregatedPageProject[]>([]);

const searchText = ref('');
const filterAccountId = ref<number | null>(null);
const sortBy = ref<'modified' | 'name' | 'account'>('modified');
const groupByAccount = ref(0);

const groupByOptions = [
  { label: '平铺展示', value: 0 },
  { label: '按账户分组', value: 1 },
];

const sortOptions = [
  { label: '按更新时间', value: 'modified' },
  { label: '按项目名', value: 'name' },
  { label: '按账户名', value: 'account' },
];

const accountOptions = computed(() => {
  if (!summary.value || !summary.value.accounts) return [];
  const seen = new Map<number, string>();
  for (const a of summary.value.accounts) {
    if (!seen.has(a.account_id)) seen.set(a.account_id, a.account_name);
  }
  return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
});

const filteredProjects = computed(() => {
  let list = projects.value.slice();
  if (filterAccountId.value != null) {
    list = list.filter(p => p.account_id === filterAccountId.value);
  }
  const q = searchText.value.trim().toLowerCase();
  if (q) {
    list = list.filter(p => {
      const inName = p.name.toLowerCase().includes(q);
      const inAccount = (p.account_name || '').toLowerCase().includes(q);
      const inDomains = (p.domains || []).some(d => d.toLowerCase().includes(q));
      return inName || inAccount || inDomains;
    });
  }
  list.sort((a, b) => {
    if (sortBy.value === 'name') return (a.name || '').localeCompare(b.name || '');
    if (sortBy.value === 'account') return (a.account_name || '').localeCompare(b.account_name || '');
    return new Date(b.modified_on || 0).getTime() - new Date(a.modified_on || 0).getTime();
  });
  return list;
});

const groupedProjects = computed(() => {
  const groups = new Map<number, { account_id: number; account_name: string; error: string | null; projects: AggregatedPageProject[] }>();
  for (const p of filteredProjects.value) {
    if (!groups.has(p.account_id)) {
      groups.set(p.account_id, { account_id: p.account_id, account_name: p.account_name, error: null, projects: [] });
    }
    groups.get(p.account_id)!.projects.push(p);
  }
  if (summary.value && summary.value.accounts) {
    for (const acc of summary.value.accounts) {
      if (acc.error && !groups.has(acc.account_id)) {
        groups.set(acc.account_id, {
          account_id: acc.account_id,
          account_name: acc.account_name,
          error: acc.error,
          projects: [],
        });
      }
    }
  }
  return Array.from(groups.values()).sort((a, b) =>
    (a.account_name || '').localeCompare(b.account_name || ''),
  );
});

const entryDomainCount = computed(() =>
  projects.value.reduce((sum, p) => sum + (p.domains?.length || 0), 0),
);

// Split failed accounts by error_kind so we can show a dedicated, actionable
// alert for decrypt failures (with a one-click "reset credentials" button)
// separately from generic Cloudflare API failures.
const decryptFailed = computed(() =>
  (summary.value?.failed_accounts || []).filter(f => f.error_kind === 'decrypt'),
);
const apiFailed = computed(() =>
  (summary.value?.failed_accounts || []).filter(f => f.error_kind !== 'decrypt'),
);

async function load() {
  loading.value = true;
  try {
    const { data } = await pagesAggregatorApi.getAll();
    summary.value = data;
    projects.value = data.projects || [];
  } catch (err: any) {
    message.error(err?.errorMessage || '拉取 Pages 列表失败');
    summary.value = null;
    projects.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadDetailed() {
  loadingDetailed.value = true;
  try {
    const { data } = await pagesAggregatorApi.getDetailed();
    if (summary.value) {
      summary.value = {
        ...summary.value,
        projects: data.projects,
      };
    } else {
      summary.value = {
        total_projects: data.total_projects,
        total_accounts: data.total_accounts,
        healthy_accounts: data.total_accounts,
        failed_accounts: [],
        accounts: [],
        projects: data.projects,
      };
    }
    projects.value = data.projects || [];
    message.success(`已加载 ${data.projects.length} 个项目（含自定义域名）`);
  } catch (err: any) {
    message.error(err?.errorMessage || '加载自定义域名失败');
  } finally {
    loadingDetailed.value = false;
  }
}

function openEntry(url: string) {
  const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  window.open(full, '_blank', 'noopener,noreferrer');
}

async function resetBrokenCredentials() {
  if (decryptFailed.value.length === 0) return;
  resetting.value = true;
  try {
    const { data } = await apiClient.post('/accounts/reset-broken-credentials');
    const resetIds = (data?.reset as number[]) || [];
    message.success(`已重置 ${resetIds.length} 个账户的加密凭证，请在「账号管理」中重新录入`);
    // Reload aggregator so the warning disappears.
    await load();
  } catch (err: any) {
    message.error(err?.errorMessage || '重置凭证失败');
  } finally {
    resetting.value = false;
  }
}

onMounted(() => {
  load();
});
</script>

<style scoped>
.page-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

.card-grid-scroll {
  width: 100%;
  max-height: calc(100vh - 280px);
  overflow-y: auto;
  padding: 30px 10px 30px 0;
}

.stat-card {
}

.pages-card {
  border: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.08));
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: all 0.15s ease;
  height: 100%;
}
.pages-card:hover {
  border-color: #18a058;
  box-shadow: 0 4px 12px rgba(24, 160, 88, 0.12);
  transform: translateY(-1px);
}
.pages-card__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 6px;
}
.pages-card__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.pages-card__name {
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pages-card__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}
.pages-card__row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pages-card__label {
  color: var(--n-text-color-3, #999);
  min-width: 56px;
  flex-shrink: 0;
}
.pages-card__value {
  color: var(--n-text-color, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pages-card__domains {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
}
.pages-card__domain {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 180px;
}
.pages-card__domain-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pages-card__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px dashed var(--n-border-color, rgba(0, 0, 0, 0.06));
}
</style>
