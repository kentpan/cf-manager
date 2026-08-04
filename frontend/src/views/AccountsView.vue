<template>
  <div class="page-view">
    <n-space justify="space-between" align="center">
      <n-h2>账号管理</n-h2>
      <n-space>
        <n-button @click="showImportModal = true">导入 CSV</n-button>
        <n-button type="primary" @click="showAddModal = true">添加账号</n-button>
      </n-space>
    </n-space>

    <n-space align="center" :size="12" style="margin: 12px 0;">
      <n-button-group size="small">
        <n-button :type="accountStore.filter === 'all' ? 'primary' : 'default'" @click="handleFilterChange('all')">全部 ({{ accountStore.counts.all }})</n-button>
        <n-button :type="accountStore.filter === 'active' ? 'primary' : 'default'" @click="handleFilterChange('active')">活跃 ({{ accountStore.counts.active }})</n-button>
        <n-button :type="accountStore.filter === 'unverified' ? 'primary' : 'default'" @click="handleFilterChange('unverified')">未验证 ({{ accountStore.counts.unverified }})</n-button>
      </n-button-group>
      <n-button
        size="small"
        type="warning"
        :loading="batchTesting"
        :disabled="accountStore.filter === 'unverified' && accountStore.counts.unverified === 0"
        @click="handleTestBatch"
      >
        批量测试{{ accountStore.filter === 'unverified' ? '未验证' : '全部' }}账户
      </n-button>
      <n-input
        v-model:value="searchInput"
        size="small"
        placeholder="搜索名称/邮箱"
        clearable
        style="width: 200px;"
        @update:value="handleSearchInput"
      />
    </n-space>

    <n-data-table
      :columns="columns"
      :data="accountStore.accounts"
      :loading="accountStore.loading"
      :bordered="false"
      :scroll-x="1200"
      :pagination="paginationConfig"
      :remote="true"
      :row-key="(row: any) => row.id"
      v-model:checked-row-keys="checkedRowKeys"
    />

    <!-- 批量操作栏 -->
    <n-space v-if="checkedRowKeys.length > 0" align="center" :size="8" style="margin-top: 12px; padding: 10px 12px; background: var(--info-color-suppl); border-radius: 6px;">
      <n-text strong style="color: #fff">已选 {{ checkedRowKeys.length }} 项</n-text>
      <n-button size="small" @click="openBatchFeatures">批量设置功能</n-button>
      <n-button v-if="!isWorkerPlatform" size="small" @click="openBatchProxy">批量设置代理</n-button>
      <n-button size="small" type="error" @click="showBatchDeleteConfirm = true">批量删除</n-button>
      <n-button size="small" quaternary @click="checkedRowKeys = []" style="color: #fff">取消选择</n-button>
    </n-space>

    <n-modal v-model:show="showAddModal" preset="dialog" :title="editingId === null ? '添加账号' : '编辑账号'" style="width: 500px; max-width: 95vw">
      <n-form :model="form" label-placement="left" label-width="100">
        <n-form-item label="名称">
          <n-input v-model:value="form.name" placeholder="账号名称" />
        </n-form-item>
        <n-form-item label="认证类型">
          <n-select v-model:value="form.auth_type" :options="authTypeOptions" />
        </n-form-item>
        <n-form-item v-if="form.auth_type === 'token'" label="API Token">
          <n-input v-model:value="form.api_token" type="password" show-password-on="click" :placeholder="editingId === null ? 'Cloudflare API Token' : '不填则保留原 Token'" />
        </n-form-item>
        <n-form-item v-if="form.auth_type === 'global_key'" label="Email">
          <n-input v-model:value="form.email" :placeholder="editingId === null ? 'Cloudflare 账号邮箱' : (editingOriginalEmail ? `原邮箱: ${editingOriginalEmail}，不填则保留` : '不填则保留原邮箱')" />
        </n-form-item>
        <n-form-item v-if="form.auth_type === 'global_key'" label="API Key">
          <n-input v-model:value="form.api_key" type="password" show-password-on="click" :placeholder="editingId === null ? 'Cloudflare API Key' : '不填则保留原 Key'" />
        </n-form-item>
        <n-form-item v-if="editingId === null" label="启用功能">
          <n-checkbox-group v-model:value="form.features">
            <n-space>
              <n-checkbox v-for="f in featureOptions" :key="f.value" :value="f.value" :label="f.label" />
            </n-space>
          </n-checkbox-group>
        </n-form-item>
      </n-form>
      <template #action>
        <n-button @click="showAddModal = false">取消</n-button>
        <n-button type="primary" :loading="submitting" @click="handleSubmit">提交</n-button>
      </template>
    </n-modal>

    <n-modal v-model:show="showFeatureModal" preset="dialog" title="编辑功能开关" style="width: 400px; max-width: 95vw">
      <n-checkbox-group v-model:value="editFeatures">
        <n-space vertical>
          <n-checkbox v-for="f in featureOptions" :key="f.value" :value="f.value" :label="f.label" />
        </n-space>
      </n-checkbox-group>
      <template #action>
        <n-button @click="showFeatureModal = false">取消</n-button>
        <n-button type="primary" :loading="submitting" @click="handleSaveFeatures">保存</n-button>
      </template>
    </n-modal>

    <!-- 单个账户代理设置 -->
    <n-modal v-model:show="showProxyModal" preset="dialog" title="设置账户代理" style="width: 460px; max-width: 95vw">
      <n-form label-placement="left" label-width="90">
        <n-form-item label="代理 URL">
          <n-input v-model:value="proxyForm.proxy_url" placeholder="可选，为该账户指定专属代理（如 http://127.0.0.1:7890）" clearable />
        </n-form-item>
        <n-form-item label="启用代理">
          <n-switch v-model:value="proxyForm.proxy_enabled" :disabled="!proxyForm.proxy_url" />
          <n-text depth="3" style="margin-left: 8px; font-size: 12px">
            {{ proxyForm.proxy_enabled ? '该账户将通过专属代理访问 Cloudflare API' : proxyForm.proxy_url ? '已关闭，将使用全局代理或直连' : '请先填写代理 URL' }}
          </n-text>
        </n-form-item>
      </n-form>
      <template #action>
        <n-button @click="showProxyModal = false">取消</n-button>
        <n-button type="primary" :loading="submitting" @click="handleSaveProxy">保存</n-button>
      </template>
    </n-modal>

    <n-modal v-model:show="showImportModal" preset="dialog" title="导入 CSV" style="width: 700px; max-width: 95vw">
      <n-space vertical :size="16">
        <n-alert type="info" :bordered="false">
          CSV 表头须包含 <n-text code>email</n-text> 和 <n-text code>apiKey</n-text>（可选 <n-text code>password</n-text>）。
          系统会按邮箱去重；账户名自动从邮箱提取（如 lauren.bailey2701@xx → bailey2701）；单个账户错误不影响其他账户导入。
        </n-alert>
        <n-upload
          :max="1"
          accept=".csv,text/csv,text/plain"
          :default-upload="false"
          :show-file-list="true"
          v-model:file-list="importFileList"
        >
          <n-button>选择 CSV 文件</n-button>
        </n-upload>
        <n-checkbox v-model:checked="skipVerify">
          跳过凭证验证（秒级完成，后续逐个「测试」激活；适合大批量导入）
        </n-checkbox>
        <n-alert v-if="importing" type="info" :bordered="false">
          正在处理中，请耐心等待…（并发批处理，每批 5 条；跳过验证时每批 20 条）
        </n-alert>
        <n-space v-if="importResult">
          <n-statistic label="总计" :value="importResult.summary.total" />
          <n-statistic label="成功" :value="importResult.summary.success" />
          <n-statistic label="跳过" :value="importResult.summary.skipped" />
          <n-statistic label="失败" :value="importResult.summary.error" />
        </n-space>
        <n-data-table
          v-if="importResult"
          :columns="importResultColumns"
          :data="importResult.results"
          :bordered="false"
          size="small"
          :max-height="300"
        />
      </n-space>
      <template #action>
        <n-button @click="closeImportModal">关闭</n-button>
        <n-button type="primary" :loading="importing" :disabled="!importFile" @click="handleImport">开始导入</n-button>
      </template>
    </n-modal>

    <n-modal v-model:show="showBatchResultModal" preset="dialog" title="批量测试结果" style="width: 700px; max-width: 95vw">
      <n-space vertical :size="16">
        <n-space>
          <n-statistic label="总计" :value="batchResult?.summary.total ?? 0" />
          <n-statistic label="成功" :value="batchResult?.summary.success ?? 0" />
          <n-statistic label="失败" :value="batchResult?.summary.error ?? 0" />
        </n-space>
        <n-data-table
          v-if="batchResult"
          :columns="batchResultColumns"
          :data="batchResult.results"
          :bordered="false"
          size="small"
          :max-height="300"
        />
      </n-space>
      <template #action>
        <n-button type="primary" @click="showBatchResultModal = false">关闭</n-button>
      </template>
    </n-modal>

    <n-modal v-model:show="showCredModal" preset="dialog" title="查看 API 凭证" style="width: 560px; max-width: 95vw">
      <n-spin :show="credLoading">
        <n-space vertical :size="12" v-if="credData">
          <n-alert type="warning" :bordered="false">
            凭证信息敏感，请勿泄露。每次查看都会记录审计日志。
          </n-alert>
          <n-descriptions label-placement="left" bordered :column="1" size="small">
            <n-descriptions-item label="名称">{{ credData.name }}</n-descriptions-item>
            <n-descriptions-item label="Account ID">
              <n-text :style="{ fontFamily: 'monospace' }">{{ credData.account_id || '-' }}</n-text>
            </n-descriptions-item>
            <n-descriptions-item label="认证类型">
              <n-tag size="small" :type="credData.auth_type === 'token' ? 'info' : 'warning'">
                {{ credData.auth_type === 'token' ? 'API Token' : 'API Key + Email' }}
              </n-tag>
            </n-descriptions-item>
            <n-descriptions-item v-if="credData.auth_type === 'global_key'" label="Email">
              {{ credData.email || '-' }}
            </n-descriptions-item>
            <n-descriptions-item v-if="credData.auth_type === 'token'" label="API Token">
              <n-input
                :value="credData.api_token || ''"
                type="password"
                show-password-on="click"
                readonly
                :style="{ fontFamily: 'monospace' }"
              />
            </n-descriptions-item>
            <n-descriptions-item v-if="credData.auth_type === 'global_key'" label="API Key">
              <n-input
                :value="credData.api_key || ''"
                type="password"
                show-password-on="click"
                readonly
                :style="{ fontFamily: 'monospace' }"
              />
            </n-descriptions-item>
            <n-descriptions-item v-if="credData.password" label="登录密码">
              <n-input
                :value="credData.password"
                type="password"
                show-password-on="click"
                readonly
                :style="{ fontFamily: 'monospace' }"
              />
            </n-descriptions-item>
            <n-descriptions-item v-if="!isWorkerPlatform" label="代理 URL">
              <n-text :style="{ fontFamily: 'monospace' }">{{ credData.proxy_url || '—' }}</n-text>
            </n-descriptions-item>
            <n-descriptions-item v-if="!isWorkerPlatform && credData.proxy_url" label="代理状态">
              <n-tag :type="credData.proxy_enabled ? 'success' : 'default'" size="small">
                {{ credData.proxy_enabled ? '已启用' : '已关闭' }}
              </n-tag>
            </n-descriptions-item>
          </n-descriptions>
        </n-space>
      </n-spin>
      <template #action>
        <n-button @click="showCredModal = false">关闭</n-button>
      </template>
    </n-modal>

    <!-- 批量设置功能 -->
    <n-modal v-model:show="showBatchFeaturesModal" preset="dialog" title="批量设置功能开关" style="width: 420px; max-width: 95vw">
      <n-checkbox-group v-model:value="batchFeatures">
        <n-space vertical>
          <n-checkbox v-for="f in featureOptions" :key="f.value" :value="f.value" :label="f.label" />
        </n-space>
      </n-checkbox-group>
      <template #action>
        <n-button @click="showBatchFeaturesModal = false">取消</n-button>
        <n-button type="primary" :loading="batchOperating" @click="handleBatchFeatures">确认设置 ({{ checkedRowKeys.length }} 个账户)</n-button>
      </template>
    </n-modal>

    <!-- 批量设置代理 -->
    <n-modal v-model:show="showBatchProxyModal" preset="dialog" title="批量设置代理" style="width: 460px; max-width: 95vw">
      <n-form label-placement="left" label-width="90">
        <n-form-item label="代理 URL">
          <n-input v-model:value="batchProxyUrl" placeholder="留空则不清除已有代理设置" clearable />
        </n-form-item>
        <n-form-item label="启用代理">
          <n-switch v-model:value="batchProxyEnabled" />
          <n-text depth="3" style="margin-left: 8px; font-size: 12px">{{ batchProxyEnabled ? '开启' : '关闭' }}</n-text>
        </n-form-item>
        <n-alert type="info" :bordered="false" style="margin-top: 8px">
          如果 URL 留空，仅更新开关状态；URL 不为空时两者同时生效。
        </n-alert>
      </n-form>
      <template #action>
        <n-button @click="showBatchProxyModal = false">取消</n-button>
        <n-button type="primary" :loading="batchOperating" @click="handleBatchProxy">确认设置 ({{ checkedRowKeys.length }} 个账户)</n-button>
      </template>
    </n-modal>

    <!-- 批量删除确认 -->
    <n-modal v-model:show="showBatchDeleteConfirm" preset="dialog" title="批量删除确认" type="error" style="width: 440px; max-width: 95vw">
      <n-alert type="error" :bordered="false">
        确定要删除选中的 <strong>{{ checkedRowKeys.length }}</strong> 个账户吗？此操作不可恢复。
      </n-alert>
      <template #action>
        <n-button @click="showBatchDeleteConfirm = false">取消</n-button>
        <n-button type="error" :loading="batchOperating" @click="handleBatchDelete">确认删除</n-button>
      </template>
    </n-modal>

    <!-- 批量操作结果 -->
    <n-modal v-model:show="showBatchOpResult" preset="dialog" title="批量操作结果" style="width: 700px; max-width: 95vw">
      <n-space vertical :size="16">
        <n-space>
          <n-statistic label="总计" :value="batchOpResult?.summary.total ?? 0" />
          <n-statistic label="成功" :value="batchOpResult?.summary.success ?? 0" />
          <n-statistic label="跳过" :value="batchOpResult?.summary.skipped ?? 0" />
          <n-statistic label="失败" :value="batchOpResult?.summary.error ?? 0" />
        </n-space>
        <n-data-table
          v-if="batchOpResult"
          :columns="batchOpResultColumns"
          :data="batchOpResult.results"
          :bordered="false"
          size="small"
          :max-height="300"
        />
      </n-space>
      <template #action>
        <n-button type="primary" @click="showBatchOpResult = false">关闭</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, h, computed, onMounted } from 'vue';
import { NButton, NSpace, NProgress, NTag, NDropdown, NTooltip, useMessage } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import type { UploadFileInfo } from 'naive-ui';
import { useAccountStore } from '../stores/accountStore';
import { accountsApi } from '../api/accounts';
import { dialog } from '../utils/discreteApi';
import { settingsApi } from '../api/settings';

type BatchOpResult = { summary: { total: number; success: number; skipped: number; error: number }; results: Array<{ id: number; name: string; status: 'success' | 'skipped' | 'error'; message?: string }> };

const accountStore = useAccountStore();
const message = useMessage();
const showAddModal = ref(false);
const editingId = ref<number | null>(null);
const editingOriginalEmail = ref<string>('');
const showFeatureModal = ref(false);
const showImportModal = ref(false);
const showBatchResultModal = ref(false);
const batchTesting = ref(false);
const batchResult = ref<{ summary: { total: number; success: number; error: number }; results: Array<{ id: number; name: string; status: 'success' | 'error'; message?: string }> } | null>(null);
const submitting = ref(false);
const importing = ref(false);
const skipVerify = ref(false);
const importFileList = ref<UploadFileInfo[]>([]);
const importResult = ref<{ summary: { total: number; success: number; skipped: number; error: number }; results: Array<{ email: string; name: string; status: 'success' | 'skipped' | 'error'; message?: string }> } | null>(null);
const editingAccountId = ref<number | null>(null);
const editFeatures = ref<string[]>([]);

// 单账户代理设置
const showProxyModal = ref(false);
const proxyAccountId = ref<number | null>(null);
const proxyForm = ref({ proxy_url: '', proxy_enabled: false });
const searchInput = ref('');

// Worker 平台不支持代理
const isWorkerPlatform = ref(false);

// 批量操作状态
const checkedRowKeys = ref<number[]>([]);
const batchOperating = ref(false);
const showBatchFeaturesModal = ref(false);
const batchFeatures = ref<string[]>(['ai', 'workers', 'browser_render', 'dns', 'storage']);
const showBatchProxyModal = ref(false);
const batchProxyUrl = ref('');
const batchProxyEnabled = ref(false);
const showBatchDeleteConfirm = ref(false);
const showBatchOpResult = ref(false);
const batchOpResult = ref<BatchOpResult | null>(null);
const batchOpResultColumns: DataTableColumns<any> = [
  { title: 'ID', key: 'id', width: 60 },
  { title: '名称', key: 'name', width: 150 },
  {
    title: '结果', key: 'status', width: 90,
    render: (row) => {
      const map: Record<string, { type: any; text: string }> = {
        success: { type: 'success', text: '成功' },
        skipped: { type: 'warning', text: '跳过' },
        error: { type: 'error', text: '失败' },
      };
      const m = map[row.status] || { type: 'default', text: row.status };
      return h(NTag, { size: 'small', type: m.type, bordered: false }, { default: () => m.text });
    },
  },
  { title: '说明', key: 'message', width: 180, minWidth: 100, ellipsis: { tooltip: true }, render: (row) => row.message || '-' },
];

// 查看 API 凭证
const showCredModal = ref(false);
const credLoading = ref(false);
const credData = ref<{
  id: number;
  name: string;
  auth_type: 'token' | 'global_key';
  account_id: string | null;
  email: string | null;
  api_token: string | null;
  api_key: string | null;
  password: string | null;
  proxy_url: string;
  proxy_enabled: number;
} | null>(null);

async function handleViewCredentials(row: any) {
  showCredModal.value = true;
  credLoading.value = true;
  credData.value = null;
  try {
    credData.value = await accountStore.getCredentials(row.id);
  } catch (e: any) {
    message.error(`获取凭证失败：${e?.message || e}`);
    showCredModal.value = false;
  } finally {
    credLoading.value = false;
  }
}

const importFile = computed<File | null>(() => {
  const item = importFileList.value[0];
  return item?.file ?? null;
});

// 远程分页配置：与 store 状态联动
const paginationConfig = computed(() => ({
  page: accountStore.page,
  pageSize: accountStore.pageSize,
  itemCount: accountStore.total,
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100],
  prefix: ({ itemCount }: any) => `共 ${itemCount} 条`,
  onUpdatePage: (p: number) => { accountStore.setPage(p); },
  onUpdatePageSize: (ps: number) => { accountStore.setPageSize(ps); },
}));

function handleFilterChange(f: 'all' | 'active' | 'unverified') {
  accountStore.setFilter(f);
}

// 搜索防抖
let searchTimer: ReturnType<typeof setTimeout> | null = null;
function handleSearchInput(val: string) {
  searchInput.value = val;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    accountStore.setSearch(val);
  }, 400);
}

const featureOptions = [
  { label: 'Workers AI', value: 'ai' },
  { label: 'Workers / Pages', value: 'workers' },
  { label: '浏览器渲染', value: 'browser_render' },
  { label: 'DNS 管理', value: 'dns' },
  { label: '存储管理', value: 'storage' },
];

const featureLabelMap: Record<string, string> = {
  ai: 'AI',
  workers: 'Workers',
  browser_render: '浏览器',
  dns: 'DNS',
  storage: '存储',
};

const form = ref({
  name: '',
  auth_type: 'token',
  api_token: '',
  api_key: '',
  email: '',
  features: ['ai', 'workers', 'browser_render', 'dns', 'storage'] as string[],
});

const authTypeOptions = [
  { label: 'API Token', value: 'token' },
  { label: 'API Key + Email', value: 'global_key' },
];

function resetForm() {
  form.value = { name: '', auth_type: 'token', api_token: '', api_key: '', email: '', features: ['ai', 'workers', 'browser_render', 'dns', 'storage'] };
}

async function handleSubmit() {
  if (!form.value.name) {
    message.warning('请输入账号名称');
    return;
  }
  submitting.value = true;
  try {
    const { features, ...rest } = form.value;
    const payload: any = { name: rest.name, auth_type: rest.auth_type };
    // 仅发送用户实际填写的凭证字段；空串一律剔除，避免覆盖原凭证
    if (rest.auth_type === 'token') {
      if (rest.api_token) payload.api_token = rest.api_token;
    } else {
    if (rest.api_key) payload.api_key = rest.api_key;
    if (rest.email) payload.email = rest.email;
  }
  if (editingId.value === null) {
      // 添加模式：凭证必填（后端校验）
      await accountStore.createAccount({ ...payload, enabled_features: features.join(',') });
      message.success('账号添加成功');
    } else {
      await accountStore.updateAccount(editingId.value, payload);
      message.success('账号更新成功');
    }
    showAddModal.value = false;
    resetForm();
    editingId.value = null;
  } finally {
    submitting.value = false;
  }
}

function openAccountEditor(row: any) {
  editingId.value = row.id;
  editingOriginalEmail.value = row.email || '';
  form.value = {
    name: row.name,
    auth_type: row.auth_type,
    api_token: '',
    api_key: '',
    email: '',
    features: parseFeatures(row.enabled_features),
  };
  showAddModal.value = true;
}

function openFeatureEditor(row: any) {
  editingAccountId.value = row.id;
  const raw = row.enabled_features || 'ai,workers,browser_render,dns,storage';
  editFeatures.value = raw.split(',').filter(Boolean);
  showFeatureModal.value = true;
}

async function handleSaveFeatures() {
  if (editingAccountId.value == null) return;
  submitting.value = true;
  try {
    await accountStore.updateFeatures(editingAccountId.value, editFeatures.value.join(','));
    message.success('功能开关已更新');
    showFeatureModal.value = false;
  } finally {
    submitting.value = false;
  }
}

function openProxyEditor(row: any) {
  proxyAccountId.value = row.id;
  proxyForm.value = { proxy_url: row.proxy_url || '', proxy_enabled: !!row.proxy_enabled };
  showProxyModal.value = true;
}

async function handleSaveProxy() {
  if (proxyAccountId.value == null) return;
  submitting.value = true;
  try {
    await accountStore.updateAccount(proxyAccountId.value, {
      proxy_url: proxyForm.value.proxy_url,
      proxy_enabled: proxyForm.value.proxy_enabled ? 1 : 0,
    });
    message.success('账户代理已更新');
    showProxyModal.value = false;
    await accountStore.fetchAccounts();
  } finally {
    submitting.value = false;
  }
}

async function handleTest(row: any) {
  await accountStore.testAccount(row.id);
  message.success('连接测试成功');
}

async function handleClearExhausted(row: any) {
  try {
    await accountStore.clearExhausted(row.id);
    message.success('已清除 AI 配额耗尽标记');
  } catch (e: any) {
    message.error(`清除失败：${e?.message || e}`);
  }
}

async function handleTestBatch() {
  batchTesting.value = true;
  batchResult.value = null;
  try {
    const onlyUnverified = accountStore.filter === 'unverified';
    const result = await accountStore.testBatch({ onlyUnverified });
    batchResult.value = result;
    showBatchResultModal.value = true;
    const s = result.summary;
    message.success(`批量测试完成：成功 ${s.success}，失败 ${s.error}`);
  } catch (e: any) {
    message.error(`批量测试失败：${e?.message || e}`);
  } finally {
    batchTesting.value = false;
  }
}

// ============ 批量操作 ============
function openBatchFeatures() {
  batchFeatures.value = ['ai', 'workers', 'browser_render', 'dns', 'storage'];
  showBatchFeaturesModal.value = true;
}

async function handleBatchFeatures() {
  batchOperating.value = true;
  try {
    const { data } = await accountsApi.batchFeatures(checkedRowKeys.value, batchFeatures.value.join(','));
    batchOpResult.value = data as BatchOpResult;
    showBatchFeaturesModal.value = false;
    showBatchOpResult.value = true;
    checkedRowKeys.value = [];
    await accountStore.fetchAccounts();
    const s = batchOpResult.value.summary;
    message.success(`批量设置功能完成：成功 ${s.success}，跳过 ${s.skipped}，失败 ${s.error}`);
  } catch (e: any) {
    message.error(`批量设置功能失败：${e?.message || e}`);
  } finally {
    batchOperating.value = false;
  }
}

function openBatchProxy() {
  batchProxyUrl.value = '';
  batchProxyEnabled.value = false;
  showBatchProxyModal.value = true;
}

async function handleBatchProxy() {
  batchOperating.value = true;
  try {
    const payload: any = {};
    if (batchProxyUrl.value) payload.proxy_url = batchProxyUrl.value;
    payload.proxy_enabled = batchProxyEnabled.value ? 1 : 0;
    const { data } = await accountsApi.batchProxy(checkedRowKeys.value, payload);
    batchOpResult.value = data as BatchOpResult;
    showBatchProxyModal.value = false;
    showBatchOpResult.value = true;
    checkedRowKeys.value = [];
    await accountStore.fetchAccounts();
    const s = batchOpResult.value.summary;
    message.success(`批量设置代理完成：成功 ${s.success}，跳过 ${s.skipped}，失败 ${s.error}`);
  } catch (e: any) {
    message.error(`批量设置代理失败：${e?.message || e}`);
  } finally {
    batchOperating.value = false;
  }
}

async function handleBatchDelete() {
  batchOperating.value = true;
  try {
    const { data } = await accountsApi.batchDelete(checkedRowKeys.value);
    batchOpResult.value = data as BatchOpResult;
    showBatchDeleteConfirm.value = false;
    showBatchOpResult.value = true;
    checkedRowKeys.value = [];
    await accountStore.fetchAccounts();
    const s = batchOpResult.value.summary;
    message.success(`批量删除完成：成功 ${s.success}，跳过 ${s.skipped}，失败 ${s.error}`);
  } catch (e: any) {
    message.error(`批量删除失败：${e?.message || e}`);
  } finally {
    batchOperating.value = false;
  }
}

const batchResultColumns: DataTableColumns<any> = [
  { title: 'ID', key: 'id', width: 60 },
  { title: '名称', key: 'name', width: 150 },
  {
    title: '结果', key: 'status', width: 90,
    render: (row) => {
      const map: Record<string, { type: any; text: string }> = {
        success: { type: 'success', text: '成功' },
        error: { type: 'error', text: '失败' },
      };
      const m = map[row.status] || { type: 'default', text: row.status };
      return h(NTag, { size: 'small', type: m.type, bordered: false }, { default: () => m.text });
    },
  },
  { title: '说明', key: 'message', width: 180, minWidth: 100, ellipsis: { tooltip: true }, render: (row) => row.message || '-' },
];

async function handleDelete(row: any) {
  await accountStore.deleteAccount(row.id);
  message.success('已删除');
}

// 操作列「更多」下拉菜单路由
function handleActionMenu(key: string, row: any) {
  switch (key) {
    case 'cred':
      handleViewCredentials(row);
      break;
    case 'features':
      openFeatureEditor(row);
      break;
    case 'proxy':
      openProxyEditor(row);
      break;
    case 'clearExhausted':
      handleClearExhausted(row);
      break;
    case 'delete':
      dialog.warning({
        title: '删除账户',
        content: `确定要删除账户 "${row.name}" 吗？此操作不可恢复。`,
        positiveText: '删除',
        negativeText: '取消',
        onPositiveClick: () => handleDelete(row),
      });
      break;
  }
}

function closeImportModal() {
  showImportModal.value = false;
  importFileList.value = [];
  importResult.value = null;
  skipVerify.value = false;
}

async function handleImport() {
  if (!importFile.value) {
    message.warning('请选择 CSV 文件');
    return;
  }
  importing.value = true;
  importResult.value = null;
  try {
    const result = await accountStore.importCsv(importFile.value, skipVerify.value);
    importResult.value = result;
    const s = result.summary;
    message.success(`导入完成：成功 ${s.success}，跳过 ${s.skipped}，失败 ${s.error}${skipVerify.value ? '（已跳过验证，请逐个测试激活）' : ''}`);
  } finally {
    importing.value = false;
  }
}

const importResultColumns: DataTableColumns<any> = [
  { title: '邮箱', key: 'email', width: 220, ellipsis: { tooltip: true } },
  { title: '账户名', key: 'name', width: 140 },
  {
    title: '结果', key: 'status', width: 90,
    render: (row) => {
      const map: Record<string, { type: any; text: string }> = {
        success: { type: 'success', text: '成功' },
        skipped: { type: 'warning', text: '跳过' },
        error: { type: 'error', text: '失败' },
      };
      const m = map[row.status] || { type: 'default', text: row.status };
      return h(NTag, { size: 'small', type: m.type, bordered: false }, { default: () => m.text });
    },
  },
  { title: '说明', key: 'message', width: 180, minWidth: 100, ellipsis: { tooltip: true }, render: (row) => row.message || '-' },
];

function parseFeatures(raw: string | undefined): string[] {
  return (raw || 'ai,workers,browser_render,dns,storage').split(',').filter(Boolean);
}

const columns = computed<DataTableColumns<any>>(() => {
  const cols: DataTableColumns<any> = [
  { type: 'selection', width: 40, fixed: 'left' },
  { title: 'ID', key: 'id', width: 60 },
  { title: '名称', key: 'name', width: 150 },
  { title: 'Account ID', key: 'account_id', width: 180, ellipsis: { tooltip: true }, render: (row) => row.account_id || '-' },
  { title: '认证类型', key: 'auth_type', width: 120, render: (row) => h(NTag, { size: 'small', type: row.auth_type === 'token' ? 'info' : 'warning' }, { default: () => row.auth_type === 'token' ? 'Token' : 'Key' }) },
  ];
  // Worker 平台不支持代理，隐藏代理列
  if (!isWorkerPlatform.value) {
    cols.push({ title: '代理', key: 'proxy_url', width: 80, align: 'center', render: (row) => {
      if (!row.proxy_url) return h('span', { style: { color: '#999', fontSize: '12px' } }, '—');
      return row.proxy_enabled
        ? h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => '已开启' })
        : h(NTag, { size: 'small', type: 'default', bordered: false }, { default: () => '已关闭' });
    }});
  }
  cols.push(
  {
    title: '功能', key: 'enabled_features', width: 220,
    render: (row) => {
      const features = parseFeatures(row.enabled_features);
      const tags = features.map(f =>
        h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => featureLabelMap[f] || f })
      );
      // R2 付费能力标识（与 enabled_features 区分）
      const af = (row.available_features || '').split(',').filter(Boolean);
      if (af.includes('r2')) {
        tags.push(h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => 'R2' }));
      } else if (af.includes('-r2')) {
        tags.push(h(NTag, { size: 'small', type: 'default', bordered: false, style: 'text-decoration: line-through; opacity: 0.5' }, { default: () => 'R2' }));
      }
      return h(NSpace, { size: 4 }, { default: () => tags });
    },
  },
  { title: '状态', key: 'is_active', width: 80, render: (row) => {
    if (row.is_demo) {
      return h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => '演示' });
    }
    if (row.decrypt_error) {
      return h(NTooltip, null, {
        trigger: () => h(NTag, { size: 'small', type: 'error', bordered: false }, { default: () => '需重录' }),
        default: () => '凭证无法解密，请编辑账户重新录入 API Token / Key',
      });
    }
    return h(NTag, { size: 'small', type: row.is_active ? 'success' : 'default' }, { default: () => row.is_active ? '活跃' : '未验证' });
  }},
  { title: 'AI 配额', key: 'aiQuota', width: 160, render: (row) => {
    const quotaItem = accountStore.quota.find((q: any) => q.accountId === row.id);
    if (!quotaItem || !quotaItem.resources) return h('span', { style: { color: '#999', fontSize: '12px' } }, '—');
    const aiResource = quotaItem.resources.find((r: any) => r.resource === 'ai_neurons');
    if (!aiResource) return h('span', { style: { color: '#999', fontSize: '12px' } }, '—');
    const exhausted = aiResource.exhausted;
    const pct = Math.min(100, Math.round(((aiResource.count || 0) / (aiResource.limit || 1)) * 100));
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '100px' } }, [
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
        h('span', { style: { fontSize: '12px', color: exhausted ? '#e03050' : '#666' } }, `${pct}%`),
        exhausted
          ? h(NTag, { size: 'small', type: 'error', bordered: false }, { default: () => '已耗尽' })
          : null,
      ].filter(Boolean)),
      h(NProgress, {
        type: 'line',
        percentage: pct,
        height: 6,
        showIndicator: false,
        status: exhausted ? 'error' : (pct > 90 ? 'warning' : 'success'),
      }),
    ]);
  }},
  {
    title: '操作', key: 'actions', width: 200, fixed: 'right',
    render: (row) => {
      const isExhausted = (() => {
        const quotaItem = accountStore.quota.find((q: any) => q.accountId === row.id);
        if (!quotaItem || !quotaItem.resources) return false;
        const aiResource = quotaItem.resources.find((r: any) => r.resource === 'ai_neurons');
        return aiResource?.exhausted;
      })();
      const moreOptions = [
        { label: '查看 API 凭证', key: 'cred', disabled: !!row.is_demo },
        { label: '功能开关', key: 'features', disabled: !!row.is_demo },
        ...(isWorkerPlatform.value ? [] : [{ label: '设置代理', key: 'proxy', disabled: !!row.is_demo }]),
        ...(isExhausted ? [{ label: '清除耗尽标记', key: 'clearExhausted', disabled: !!row.is_demo }] : []),
        { type: 'divider' as const, key: 'd' },
        { label: '删除账户', key: 'delete', disabled: !!row.is_demo, props: { style: 'color: var(--n-error-color)' } },
      ];
      return h(NSpace, { size: 4 }, {
        default: () => [
          h(NButton, { size: 'small', type: 'primary', ghost: true, disabled: row.is_demo, onClick: () => openAccountEditor(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', onClick: () => handleTest(row) }, { default: () => '测试' }),
          h(NDropdown, { options: moreOptions, trigger: 'click', onSelect: (key: string) => handleActionMenu(key, row) }, {
            default: () => h(NButton, { size: 'small' }, { default: () => '更多' }),
          }),
        ],
      });
    },
  });
  return cols;
});

onMounted(async () => {
  accountStore.fetchAccounts();
  // 检测运行平台（Worker 平台不支持代理功能）
  try {
    const { data } = await settingsApi.get();
    isWorkerPlatform.value = data.platform === 'cloudflare-workers';
  } catch { /* 忽略 */ }
});
</script>
