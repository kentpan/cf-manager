<template>
  <div class="page-view">
    <n-space justify="space-between" align="center" :wrap="true">
      <n-space align="center">
        <n-h2 style="margin: 0">域名管理</n-h2>
        <n-tag size="small" type="info" round>多域名注册商</n-tag>
      </n-space>
      <n-space>
        <n-button size="small" @click="openProviderModal(null)">添加提供商</n-button>
        <n-button size="small" type="primary" :disabled="!selectedProvider" @click="openAccountModal(null)">添加账号</n-button>
      </n-space>
    </n-space>

    <!-- Provider tabs -->
    <n-spin :show="loadingProviders">
      <div class="provider-grid">
        <n-card
          v-for="p in providers"
          :key="p.id"
          size="small"
          :class="['provider-card', { 'provider-card--active': selectedProviderId === p.id, 'provider-card--disabled': !p.enabled }]"
          @click="selectProvider(p.id)"
        >
          <div class="provider-card__head">
            <n-tag v-if="p.is_default" size="tiny" type="success" :bordered="false">内置</n-tag>
            <span class="provider-card__name">{{ p.name }}</span>
            <n-tag size="tiny" :type="p.enabled ? 'info' : 'default'" :bordered="false">{{ p.enabled ? '已启用' : '已禁用' }}</n-tag>
          </div>
          <div class="provider-card__meta">
            <span class="provider-card__code">{{ p.code }}</span>
            <span class="provider-card__region">
              <n-tag v-if="p.regions?.includes('CN')" size="tiny" :bordered="false" type="warning">国内</n-tag>
              <n-tag v-if="p.regions?.includes('GLOBAL')" size="tiny" :bordered="false" type="info">国际</n-tag>
            </span>
            <span class="provider-card__count">{{ accountCountMap[p.id] || 0 }} 个账号</span>
          </div>
          <div class="provider-card__capabilities">
            <n-tag
              v-for="cap in parseCapabilities(p.capabilities).slice(0, 4)"
              :key="cap"
              size="tiny"
              :bordered="false"
              :type="cap.startsWith('dns') ? 'success' : 'info'"
            >{{ cap }}</n-tag>
            <n-tag v-if="parseCapabilities(p.capabilities).length > 4" size="tiny" :bordered="false">+{{ parseCapabilities(p.capabilities).length - 4 }}</n-tag>
          </div>
        </n-card>
        <n-empty v-if="providers.length === 0" size="small" description="暂无提供商，请点击右上角添加" />
      </div>
    </n-spin>

    <!-- Selected provider info + actions -->
    <n-card v-if="selectedProvider" size="small" :bordered="true">
      <n-space justify="space-between" align="center" :wrap="true">
        <n-space align="center" :size="12" :wrap="true">
          <n-h3 style="margin: 0">{{ selectedProvider.name }}</n-h3>
          <n-tag size="small" :bordered="false" type="info">{{ selectedProvider.code }}</n-tag>
          <n-tag size="small" :bordered="false">认证: {{ authTypeLabel(selectedProvider.auth_type) }}</n-tag>
          <n-tag size="small" :bordered="false">API: {{ selectedProvider.api_base_url }}</n-tag>
          <n-button v-if="selectedProvider.doc_url" size="tiny" text type="primary" tag="a" :href="selectedProvider.doc_url" target="_blank" rel="noopener noreferrer">
            📖 API 文档
          </n-button>
          <n-tag v-if="selectedProvider.promo_url" size="small" type="warning" :bordered="false">
            推广链接:
            <n-button size="tiny" text type="primary" tag="a" :href="selectedProvider.promo_url" target="_blank" rel="noopener noreferrer">
              {{ selectedProvider.promo_url }}
            </n-button>
          </n-tag>
        </n-space>
        <n-space>
          <n-button size="small" @click="openProviderModal(selectedProvider)">编辑</n-button>
          <n-button v-if="!selectedProvider.is_default" size="small" type="error" ghost @click="handleDeleteProvider">删除</n-button>
        </n-space>
      </n-space>
    </n-card>

    <!-- Accounts table for selected provider -->
    <n-spin :show="loadingAccounts">
      <n-data-table
        :columns="accountColumns"
        :data="accounts"
        :bordered="false"
        :row-key="(row: any) => row.id"
        :max-height="300"
      />
      <n-empty v-if="!loadingAccounts && accounts.length === 0" description="暂无账号，请点击右上角「添加账号」" style="padding: 30px 0" />
    </n-spin>

    <!-- Domains section for selected account -->
    <n-card v-if="selectedAccount" size="small" :bordered="true">
      <n-space justify="space-between" align="center" :wrap="true">
        <n-space align="center">
          <n-h4 style="margin: 0">{{ selectedAccount.name }} 的免费域名</n-h4>
          <n-tag size="small" type="info" :bordered="false">{{ domains.length }} 个</n-tag>
          <n-button v-if="selectedAccountQuota" size="tiny" quaternary @click="loadQuota">
            配额: {{ selectedAccountQuota.used }} / {{ selectedAccountQuota.total }}
          </n-button>
        </n-space>
        <n-space>
          <n-input v-model:value="domainSearch" size="small" placeholder="搜索域名..." clearable style="width: 200px" @update:value="handleSearchChange" />
          <n-select v-model:value="domainStatusFilter" size="small" :options="statusFilterOptions" placeholder="状态" clearable style="width: 140px" @update:value="loadDomains" />
          <n-button size="small" @click="openRegisterModal">注册域名</n-button>
          <n-button size="small" type="primary" ghost @click="loadDomains">刷新</n-button>
        </n-space>
      </n-space>
    </n-card>

    <n-spin :show="loadingDomains" v-if="selectedAccount">
      <n-data-table
        :columns="domainColumns"
        :data="filteredDomains"
        :bordered="false"
        :row-key="(row: any) => row.id"
        :max-height="500"
        :scroll-x="900"
      />
      <n-empty v-if="!loadingDomains && filteredDomains.length === 0" description="暂无域名，请点击「注册域名」" style="padding: 30px 0" />
    </n-spin>

    <!-- Provider modal -->
    <n-modal v-model:show="showProviderModal" preset="dialog" :title="providerForm.id ? '编辑提供商' : '添加提供商'" style="width: 560px; max-width: 95vw">
      <n-form :model="providerForm" label-placement="left" label-width="100">
        <n-form-item label="名称">
          <n-input v-model:value="providerForm.name" placeholder="如 DNSHE / 阿里云 / Namecheap" />
        </n-form-item>
        <n-form-item label="代号">
          <n-input v-model:value="providerForm.code" :disabled="!!providerForm.id" placeholder="如 dnshe（小写英文，唯一，用于内部派发）" />
        </n-form-item>
        <n-form-item label="API Base URL">
          <n-input v-model:value="providerForm.api_base_url" placeholder="https://api005.dnshe.com/index.php" />
        </n-form-item>
        <n-form-item label="认证方式">
          <n-select v-model:value="providerForm.auth_type" :options="authTypeOptions" />
          <template #feedback>
            <n-text depth="3" style="font-size: 12px">header: X-API-Key+X-API-Secret | bearer: Bearer Token | query: URL 参数 | basic: HTTP Basic</n-text>
          </template>
        </n-form-item>
        <n-form-item label="能力列表">
          <n-input
            v-model:value="providerForm.capabilities"
            placeholder="逗号分隔，如 domains.list,domains.register,dns.list,dns.create"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
          />
        </n-form-item>
        <n-form-item label="API 文档">
          <n-input v-model:value="providerForm.doc_url" placeholder="https://example.com/api-docs" />
        </n-form-item>
        <n-form-item label="服务区域">
          <n-select v-model:value="providerFormRegions" :options="regionOptions" multiple />
        </n-form-item>
        <n-form-item label="推广链接">
          <n-input v-model:value="providerForm.promo_url" placeholder="默认推广/邀请链接" />
          <template #feedback>
            <n-text depth="3" style="font-size: 12px">注册域名时显示给用户，默认值：https://my.dnshe.com/go.php?code=KRDQzaIlJb</n-text>
          </template>
        </n-form-item>
        <n-form-item label="启用">
          <n-switch v-model:value="providerForm.enabled" />
        </n-form-item>
      </n-form>
      <template #action>
        <n-button @click="showProviderModal = false">取消</n-button>
        <n-button type="primary" :loading="submitting" @click="handleSubmitProvider">保存</n-button>
      </template>
    </n-modal>

    <!-- Account modal — supply.vue-style: provider grid + registration steps box + dynamic credential form -->
    <n-modal v-model:show="showAccountModal" preset="card" :title="accountForm.id ? '编辑账号' : '新增域名注册商账号'" style="width: 720px; max-width: 95vw">
      <div class="account-modal-body">
        <!-- Step 1: provider selection grid (only when adding, not editing) -->
        <div v-if="!accountForm.id" class="modal-section">
          <div class="modal-section__label">选择域名注册商 <span class="required-star">*</span></div>
          <div class="provider-select-grid">
            <button
              v-for="p in providers"
              :key="p.id"
              :class="['provider-select-card', { 'provider-select-card--active': accountModalProvider?.id === p.id }]"
              @click="selectProviderInModal(p)"
            >
              <div class="provider-select-card__head">
                <n-tag v-if="p.is_default" size="tiny" type="success" :bordered="false">内置</n-tag>
                <span class="provider-select-card__name">{{ p.name }}</span>
                <n-tag size="tiny" :bordered="false" :type="p.regions?.includes('CN') ? 'warning' : 'info'">
                  {{ p.regions?.includes('CN') ? '国内' : '国际' }}
                </n-tag>
              </div>
              <p class="provider-select-card__desc">{{ p.description || p.code }}</p>
              <div class="provider-select-card__cap">
                <n-tag
                  v-for="cap in parseCapabilities(p.capabilities).slice(0, 3)"
                  :key="cap"
                  size="tiny"
                  :bordered="false"
                  :type="cap.startsWith('dns') ? 'success' : 'info'"
                >{{ cap.split('.')[1] || cap }}</n-tag>
                <n-tag v-if="parseCapabilities(p.capabilities).length > 3" size="tiny" :bordered="false">+{{ parseCapabilities(p.capabilities).length - 3 }}</n-tag>
              </div>
            </button>
          </div>
        </div>

        <!-- Step 2: registration flow box (supply.vue-style blue panel) -->
        <div v-if="accountModalProvider" class="reg-flow-box">
          <div class="reg-flow-box__head">
            <h4 class="reg-flow-box__title">
              <n-icon :component="InformationCircleOutline" :size="16" />
              {{ accountModalProvider.name }} - 申请注册流程
            </h4>
            <div class="reg-flow-box__actions">
              <n-button v-if="accountModalProvider.doc_url" size="tiny" quaternary tag="a" :href="accountModalProvider.doc_url" target="_blank" rel="noopener noreferrer">
                <n-icon :component="OpenOutline" :size="14" /> API 文档
              </n-button>
              <n-button size="tiny" type="primary" tag="a" :href="accountModalProvider.promo_url || accountModalProvider.register_url" target="_blank" rel="noopener noreferrer">
                <n-icon :component="OpenOutline" :size="14" /> 前往注册
              </n-button>
            </div>
          </div>
          <p class="reg-flow-box__desc">{{ accountModalProvider.description }}</p>
          <p class="reg-flow-box__model">
            <span class="reg-flow-box__model-label">计费模式:</span>
            <span class="reg-flow-box__model-value">{{ accountModalProvider.commission_model || '-' }}</span>
          </p>
          <ol class="reg-flow-box__steps">
            <li v-for="(s, i) in parseRegistrationSteps(accountModalProvider.registration_steps)" :key="i" class="reg-step">
              <span class="reg-step__num">{{ i + 1 }}</span>
              <div class="reg-step__body">
                <p class="reg-step__title">{{ s.title }}</p>
                <p class="reg-step__detail">{{ s.detail }}</p>
              </div>
            </li>
          </ol>
        </div>

        <!-- Step 3: dynamic credential form (driven by provider.credential_fields) -->
        <div v-if="accountModalProvider || accountForm.id" class="modal-section">
          <div class="modal-section__label">显示名称</div>
          <n-input v-model:value="accountForm.name" placeholder="账号备注名（如 主账号）" />
          <div v-for="f in currentCredentialFields" :key="f.key" class="modal-field">
            <div class="modal-section__label">{{ f.label }} <span v-if="f.required" class="required-star">*</span></div>
            <n-input
              v-model:value="accountForm.credentials[f.key]"
              :type="f.type === 'password' ? 'password' : 'text'"
              :show-password-on="f.type === 'password' ? 'click' : undefined"
              :placeholder="accountForm.id ? `不填则保留原 ${f.label}` : f.placeholder"
            />
            <p v-if="f.help" class="modal-field__help">{{ f.help }}</p>
          </div>
          <div class="modal-section__label">
            <label style="display:block;margin-top: 15px;">启用 <n-switch v-model:value="accountForm.is_active" />
            </label>
          </div>
          
        </div>

        <!-- Security hint -->
        <n-alert v-if="accountModalProvider" type="info" :bordered="false" style="margin-top: 12px">
          凭证会以 AES-256-GCM 加密后存入数据库, 仅用于代理调用 {{ accountModalProvider.name }} API。
        </n-alert>
      </div>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showAccountModal = false">取消</n-button>
          <n-button type="primary" :loading="submitting" :disabled="!accountModalProvider && !accountForm.id" @click="handleSubmitAccount">
            <n-icon v-if="!submitting" :component="SaveOutline" :size="16" />
            {{ submitting ? '保存中...' : '保存' }}
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- Register domain modal -->
    <n-modal v-model:show="showRegisterModal" preset="dialog" title="注册免费域名" style="width: 480px; max-width: 95vw">
      <n-form :model="registerForm" label-placement="left" label-width="100">
        <n-form-item label="子域名">
          <n-input v-model:value="registerForm.subdomain" placeholder="如 myapp（不含根域名）" />
        </n-form-item>
        <n-form-item label="根域名">
          <n-input v-model:value="registerForm.rootdomain" placeholder="如 example.com" />
        </n-form-item>
        <n-alert v-if="selectedProvider && selectedProvider.promo_url" type="warning" :bordered="false" style="margin-top: 8px">
          <n-space :size="4" vertical>
            <span>如果您还没有 {{ selectedProvider.name }} 账号，可使用以下推广链接注册（支持本项目维护）：</span>
            <n-button size="tiny" text type="primary" tag="a" :href="selectedProvider.promo_url" target="_blank" rel="noopener noreferrer">
              {{ selectedProvider.promo_url }}
            </n-button>
          </n-space>
        </n-alert>
      </n-form>
      <template #action>
        <n-button @click="showRegisterModal = false">取消</n-button>
        <n-button type="primary" :loading="submitting" @click="handleRegisterDomain">注册</n-button>
      </template>
    </n-modal>

    <!-- DNS records drawer -->
    <n-drawer v-model:show="dnsDrawerShow" :width="isMobile ? '100%' : 720" placement="right">
      <n-drawer-content :title="`DNS 解析 - ${dnsDrawerDomain?.full_domain || ''}`" closable>
        <n-space align="center" :size="8" style="margin-bottom: 12px">
          <n-button size="small" type="primary" @click="openDnsForm(null)">添加记录</n-button>
          <n-button size="small" @click="loadDnsRecords" :loading="loadingDns">刷新</n-button>
        </n-space>
        <n-spin :show="loadingDns">
          <n-data-table :columns="dnsColumns" :data="dnsRecords" :bordered="false" size="small" :row-key="(r:any) => r.id" />
          <n-empty v-if="!loadingDns && dnsRecords.length === 0" description="暂无 DNS 记录" size="small" />
        </n-spin>
      </n-drawer-content>
    </n-drawer>

    <!-- DNS form modal -->
    <n-modal v-model:show="dnsFormShow" preset="dialog" :title="dnsForm.id ? '编辑 DNS 记录' : '添加 DNS 记录'" style="width: 520px; max-width: 95vw">
      <n-form :model="dnsForm" label-placement="left" label-width="90">
        <n-form-item label="类型">
          <n-select v-model:value="dnsForm.type" :options="dnsTypeOptions" />
        </n-form-item>
        <n-form-item label="名称">
          <n-input v-model:value="dnsForm.name" placeholder="@ 或留空 = 当前域名本身；支持完整子域" />
        </n-form-item>
        <n-form-item label="值">
          <n-input v-model:value="dnsForm.content" placeholder="如 192.168.1.1" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" />
        </n-form-item>
        <n-form-item label="TTL">
          <n-input-number v-model:value="dnsForm.ttl" :min="60" :max="86400" :step="60" />
        </n-form-item>
        <n-form-item v-if="dnsForm.type === 'MX'" label="优先级">
          <n-input-number v-model:value="dnsForm.priority" :min="0" :max="65535" />
        </n-form-item>
      </n-form>
      <template #action>
        <n-button @click="dnsFormShow = false">取消</n-button>
        <n-button type="primary" :loading="submitting" @click="handleSubmitDns">保存</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, h, onMounted } from 'vue';
import {
  NButton, NSpace, NTag, NDataTable, NInput, NInputNumber, NSelect, NSwitch,
  NModal, NForm, NFormItem, NCard, NH2, NH3, NH4, NSpin, NEmpty, NAlert,
  NPopconfirm, useMessage, NTooltip, NIcon,
} from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import {
  InformationCircleOutline, OpenOutline, SaveOutline,
} from '@vicons/ionicons5';
import {
  domainProvidersApi,
  parseRegistrationSteps,
  parseCredentialFields,
  type DomainProvider,
  type DomainProviderAccount,
  type DnsheSubdomain,
  type DnsheDnsRecord,
  type DnsheQuota,
  type CredentialField,
} from '../api/domainProviders';
import { formatCNShort } from '../utils/dateFormat';

const message = useMessage();
const isMobile = ref(window.innerWidth <= 768);

// ===== Provider state =====
const providers = ref<DomainProvider[]>([]);
const loadingProviders = ref(false);
const selectedProviderId = ref<number | null>(null);
const selectedProvider = computed(() => providers.value.find(p => p.id === selectedProviderId.value) || null);

// ===== Account state =====
const accounts = ref<DomainProviderAccount[]>([]);
const loadingAccounts = ref(false);
const selectedAccountId = ref<number | null>(null);
const selectedAccount = computed(() => accounts.value.find(a => a.id === selectedAccountId.value) || null);
const selectedAccountQuota = ref<DnsheQuota | null>(null);

// ===== Domain state =====
const domains = ref<DnsheSubdomain[]>([]);
const loadingDomains = ref(false);
const domainSearch = ref('');
const domainStatusFilter = ref<string | null>(null);

const statusFilterOptions = [
  { label: '全部', value: '' },
  { label: '活跃', value: 'active' },
  { label: '暂停', value: 'suspended' },
  { label: '过期', value: 'expired' },
];

const filteredDomains = computed(() => {
  if (!domainSearch.value.trim()) return domains.value;
  const q = domainSearch.value.trim().toLowerCase();
  return domains.value.filter(d =>
    (d.full_domain || '').toLowerCase().includes(q) ||
    (d.subdomain || '').toLowerCase().includes(q) ||
    (d.rootdomain || '').toLowerCase().includes(q)
  );
});

// ===== DNS drawer state =====
const dnsDrawerShow = ref(false);
const dnsDrawerDomain = ref<DnsheSubdomain | null>(null);
const dnsRecords = ref<DnsheDnsRecord[]>([]);
const loadingDns = ref(false);
const dnsFormShow = ref(false);
const dnsForm = ref<{ id?: number; record_id?: string; type: string; name: string; content: string; ttl: number; priority?: number }>({
  type: 'A', name: '', content: '', ttl: 600,
});

const dnsTypeOptions = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'].map(v => ({ label: v, value: v }));

// ===== Modal state =====
const showProviderModal = ref(false);
const showAccountModal = ref(false);
const showRegisterModal = ref(false);
const submitting = ref(false);
const providerForm = ref<{
  id?: number;
  code: string;
  name: string;
  api_base_url: string;
  auth_type: 'header' | 'bearer' | 'query' | 'basic';
  capabilities: string;
  doc_url: string;
  promo_url: string;
  enabled: boolean;
}>({
  code: '',
  name: '',
  api_base_url: '',
  auth_type: 'header',
  capabilities: 'domains.list,domains.register,dns.list,dns.create,dns.update,dns.delete',
  doc_url: '',
  promo_url: 'https://my.dnshe.com/go.php?code=KRDQzaIlJb',
  enabled: true,
});
const providerFormRegions = ref<string[]>(['GLOBAL']);
const accountForm = ref<{ id?: number; name: string; credentials: Record<string, string>; is_active: boolean }>({
  name: '', credentials: {}, is_active: true,
});
// The provider selected inside the Add Account modal (separate from
// selectedProvider which is the provider selected on the main page). When
// editing an existing account, this is looked up from the account's
// provider_id so the registration-flow box + dynamic form still render.
const accountModalProvider = ref<DomainProvider | null>(null);
const currentCredentialFields = computed<CredentialField[]>(() => {
  if (!accountModalProvider.value) return [];
  return parseCredentialFields(accountModalProvider.value.credential_fields);
});

function selectProviderInModal(p: DomainProvider) {
  accountModalProvider.value = p;
  accountForm.value.name = p.name;
  // Reset credentials with empty values for each declared field.
  const creds: Record<string, string> = {};
  for (const f of parseCredentialFields(p.credential_fields)) {
    creds[f.key] = '';
  }
  accountForm.value.credentials = creds;
}
const registerForm = ref<{ subdomain: string; rootdomain: string }>({ subdomain: '', rootdomain: '' });

const authTypeOptions = [
  { label: 'X-API-Key + X-API-Secret (Header)', value: 'header' },
  { label: 'Authorization: Bearer <token>', value: 'bearer' },
  { label: 'URL Query (?ApiKey=...)', value: 'query' },
  { label: 'HTTP Basic Auth', value: 'basic' },
];
const regionOptions = [
  { label: '国际 (GLOBAL)', value: 'GLOBAL' },
  { label: '国内 (CN)', value: 'CN' },
];

function authTypeLabel(t: string): string {
  return authTypeOptions.find(o => o.value === t)?.label || t;
}

function parseCapabilities(caps: string): string[] {
  return (caps || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Note: credential placeholders + needsApiSecret are now driven by
// currentCredentialFields (from provider.credential_fields JSON) — no more
// hardcoded switch statement per provider code. Adding a new provider just
// means editing its seed row in db.ts; the UI picks up the fields
// automatically.

// ===== Account count map =====
const accountCountMap = ref<Record<number, number>>({});

async function loadProviders() {
  loadingProviders.value = true;
  try {
    const { data } = await domainProvidersApi.listProviders();
    providers.value = data.providers || [];
    if (providers.value.length > 0) {
      // Auto-select default provider, or first one
      const def = providers.value.find(p => p.is_default) || providers.value[0];
      if (!selectedProviderId.value || !providers.value.find(p => p.id === selectedProviderId.value)) {
        selectedProviderId.value = def.id;
      }
      await loadAccounts();
    } else {
      accounts.value = [];
      selectedProviderId.value = null;
    }
  } catch (err: any) {
    message.error(err?.errorMessage || '加载提供商失败');
  } finally {
    loadingProviders.value = false;
  }
}

async function loadAccounts() {
  if (!selectedProviderId.value) {
    accounts.value = [];
    return;
  }
  loadingAccounts.value = true;
  try {
    const { data } = await domainProvidersApi.listAccounts(selectedProviderId.value);
    accounts.value = data.accounts || [];
    // Update count map
    accountCountMap.value = { ...accountCountMap.value, [selectedProviderId.value]: accounts.value.length };
    // Refresh all providers' counts in background
    for (const p of providers.value) {
      if (p.id === selectedProviderId.value) continue;
      try {
        const r = await domainProvidersApi.listAccounts(p.id);
        accountCountMap.value = { ...accountCountMap.value, [p.id]: (r.data.accounts || []).length };
      } catch { /* ignore */ }
    }
    // Reset selected account if not in list
    if (selectedAccountId.value && !accounts.value.find(a => a.id === selectedAccountId.value)) {
      selectedAccountId.value = null;
    }
  } catch (err: any) {
    message.error(err?.errorMessage || '加载账号失败');
    accounts.value = [];
  } finally {
    loadingAccounts.value = false;
  }
}

function selectProvider(id: number) {
  selectedProviderId.value = id;
  selectedAccountId.value = null;
  domains.value = [];
  loadAccounts();
}

function selectAccount(id: number) {
  selectedAccountId.value = id;
  selectedAccountQuota.value = null;
  loadDomains();
  loadQuota();
}

async function loadDomains() {
  if (!selectedAccountId.value) {
    domains.value = [];
    return;
  }
  loadingDomains.value = true;
  try {
    const params: any = {};
    if (domainStatusFilter.value) params.status = domainStatusFilter.value;
    const { data } = await domainProvidersApi.listSubdomains(selectedAccountId.value, params);
    domains.value = data.subdomains || [];
  } catch (err: any) {
    message.error(err?.errorMessage || '加载域名失败');
    domains.value = [];
  } finally {
    loadingDomains.value = false;
  }
}

function handleSearchChange() {
  // Client-side filter — no API call needed
}

async function loadQuota() {
  if (!selectedAccountId.value) return;
  try {
    const { data } = await domainProvidersApi.getQuota(selectedAccountId.value);
    selectedAccountQuota.value = data?.quota || null;
  } catch {
    // Silent: quota is a nice-to-have
  }
}

// ===== Provider form =====
function openProviderModal(provider: DomainProvider | null) {
  if (provider) {
    providerForm.value = {
      id: provider.id,
      code: provider.code,
      name: provider.name,
      api_base_url: provider.api_base_url,
      auth_type: (provider.auth_type || 'header') as 'header' | 'bearer' | 'query' | 'basic',
      capabilities: provider.capabilities || '',
      doc_url: provider.doc_url || '',
      promo_url: provider.promo_url || 'https://my.dnshe.com/go.php?code=KRDQzaIlJb',
      enabled: !!provider.enabled,
    };
    providerFormRegions.value = (provider.regions || 'GLOBAL').split(',').map(s => s.trim()).filter(Boolean);
  } else {
    providerForm.value = {
      code: '',
      name: '',
      api_base_url: '',
      auth_type: 'header',
      capabilities: 'domains.list,domains.register,dns.list,dns.create,dns.update,dns.delete',
      doc_url: '',
      promo_url: 'https://my.dnshe.com/go.php?code=KRDQzaIlJb',
      enabled: true,
    };
    providerFormRegions.value = ['GLOBAL'];
  }
  showProviderModal.value = true;
}

async function handleSubmitProvider() {
  if (!providerForm.value.name || !providerForm.value.code || !providerForm.value.api_base_url) {
    message.warning('名称、代号、API Base URL 必填');
    return;
  }
  submitting.value = true;
  try {
    const payload = {
      name: providerForm.value.name,
      code: providerForm.value.code,
      api_base_url: providerForm.value.api_base_url,
      auth_type: providerForm.value.auth_type,
      capabilities: providerForm.value.capabilities,
      doc_url: providerForm.value.doc_url,
      regions: providerFormRegions.value.join(',') || 'GLOBAL',
      promo_url: providerForm.value.promo_url,
      enabled: providerForm.value.enabled ? 1 : 0,
    };
    if (providerForm.value.id) {
      await domainProvidersApi.updateProvider(providerForm.value.id, payload);
      message.success('提供商已更新');
    } else {
      await domainProvidersApi.createProvider(payload);
      message.success('提供商已添加');
    }
    showProviderModal.value = false;
    await loadProviders();
  } catch (err: any) {
    message.error(err?.errorMessage || '保存失败');
  } finally {
    submitting.value = false;
  }
}

async function handleDeleteProvider() {
  if (!selectedProvider.value || selectedProvider.value.is_default) return;
  try {
    await domainProvidersApi.deleteProvider(selectedProvider.value.id);
    message.success('提供商已删除');
    selectedProviderId.value = null;
    await loadProviders();
  } catch (err: any) {
    message.error(err?.errorMessage || '删除失败');
  }
}

// ===== Account form =====
function openAccountModal(account: DomainProviderAccount | null) {
  if (account) {
    // Editing — look up the provider so the registration-flow box + dynamic
    // form still render in view-only-read mode.
    const provider = providers.value.find(p => p.id === account.provider_id) || null;
    accountModalProvider.value = provider;
    // Pre-fill credentials with placeholder empty strings — actual values
    // stay encrypted in the DB and aren't sent to the client.
    const creds: Record<string, string> = {};
    if (provider) {
      for (const f of parseCredentialFields(provider.credential_fields)) {
        creds[f.key] = '';
      }
    }
    accountForm.value = {
      id: account.id,
      name: account.name,
      credentials: creds,
      is_active: !!account.is_active,
    };
  } else {
    // Adding — user must pick a provider in the modal grid first.
    accountModalProvider.value = null;
    accountForm.value = { name: '', credentials: {}, is_active: true };
  }
  showAccountModal.value = true;
}

async function handleSubmitAccount() {
  if (!accountForm.value.name) {
    message.warning('名称必填');
    return;
  }
  // Validate required credential fields declared by the provider.
  if (accountModalProvider.value) {
    for (const f of parseCredentialFields(accountModalProvider.value.credential_fields)) {
      if (f.required && !accountForm.value.id) {
        // Adding — required fields must be filled.
        if (!accountForm.value.credentials[f.key]) {
          message.warning(`请填写「${f.label}」`);
          return;
        }
      }
    }
  }
  submitting.value = true;
  try {
    // Build the payload. For backward compat with the existing backend
    // route (which expects api_key / api_secret / api_user as top-level
    // fields), we map the credential dict to those keys when present.
    // New providers can add more keys and the backend will store them via
    // the same generic credentials handling.
    const creds = accountForm.value.credentials;
    const payload: any = { name: accountForm.value.name, is_active: accountForm.value.is_active ? 1 : 0 };
    if (creds.api_key) payload.api_key = creds.api_key;
    if (creds.api_secret) payload.api_secret = creds.api_secret;
    if (creds.api_user) payload.api_user = creds.api_user;
    if (accountForm.value.id) {
      await domainProvidersApi.updateAccount(accountForm.value.id, payload);
      message.success('账号已更新');
    } else if (accountModalProvider.value) {
      await domainProvidersApi.createAccount(accountModalProvider.value.id, {
        name: accountForm.value.name,
        api_key: creds.api_key || '',
        api_secret: creds.api_secret || '',
        api_user: creds.api_user || '',
        is_active: accountForm.value.is_active ? 1 : 0,
      });
      message.success('账号已添加');
    }
    showAccountModal.value = false;
    await loadAccounts();
  } catch (err: any) {
    message.error(err?.errorMessage || '保存失败');
  } finally {
    submitting.value = false;
  }
}

async function handleTestAccount(id: number) {
  const acc = accounts.value.find(a => a.id === id);
  if (!acc) return;
  message.loading('测试中...', { duration: 1500 });
  try {
    const { data } = await domainProvidersApi.testAccount(id);
    if (data?.quota) {
      message.success(`连接成功，配额: ${data.quota.used}/${data.quota.total}`);
    } else {
      message.success('连接成功');
    }
    await loadAccounts();
  } catch (err: any) {
    message.error(err?.errorMessage || '测试失败');
  }
}

async function handleDeleteAccount(id: number) {
  try {
    await domainProvidersApi.deleteAccount(id);
    message.success('账号已删除');
    if (selectedAccountId.value === id) selectedAccountId.value = null;
    await loadAccounts();
  } catch (err: any) {
    message.error(err?.errorMessage || '删除失败');
  }
}

// ===== Domain actions =====
function openRegisterModal() {
  registerForm.value = { subdomain: '', rootdomain: '' };
  showRegisterModal.value = true;
}

async function handleRegisterDomain() {
  if (!selectedAccountId.value) return;
  if (!registerForm.value.subdomain || !registerForm.value.rootdomain) {
    message.warning('子域名和根域名必填');
    return;
  }
  submitting.value = true;
  try {
    await domainProvidersApi.registerSubdomain(selectedAccountId.value, registerForm.value);
    message.success('域名注册成功');
    showRegisterModal.value = false;
    await loadDomains();
    await loadQuota();
  } catch (err: any) {
    message.error(err?.errorMessage || '注册失败');
  } finally {
    submitting.value = false;
  }
}

async function handleRenewDomain(row: DnsheSubdomain) {
  if (!selectedAccountId.value) return;
  try {
    await domainProvidersApi.renewSubdomain(selectedAccountId.value, row.id);
    message.success('续期成功');
    await loadDomains();
  } catch (err: any) {
    message.error(err?.errorMessage || '续期失败');
  }
}

async function handleDeleteDomain(row: DnsheSubdomain) {
  if (!selectedAccountId.value) return;
  try {
    await domainProvidersApi.deleteSubdomain(selectedAccountId.value, row.id);
    message.success('域名已删除');
    await loadDomains();
    await loadQuota();
  } catch (err: any) {
    message.error(err?.errorMessage || '删除失败');
  }
}

// ===== DNS records =====
async function openDnsDrawer(row: DnsheSubdomain) {
  dnsDrawerDomain.value = row;
  dnsDrawerShow.value = true;
  await loadDnsRecords();
}

async function loadDnsRecords() {
  if (!selectedAccountId.value || !dnsDrawerDomain.value) return;
  loadingDns.value = true;
  try {
    const { data } = await domainProvidersApi.listDnsRecords(selectedAccountId.value, dnsDrawerDomain.value.id);
    dnsRecords.value = data.records || [];
  } catch (err: any) {
    message.error(err?.errorMessage || '加载 DNS 记录失败');
    dnsRecords.value = [];
  } finally {
    loadingDns.value = false;
  }
}

function openDnsForm(record: DnsheDnsRecord | null) {
  if (record) {
    dnsForm.value = {
      id: record.id,
      record_id: record.record_id,
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl || 600,
      priority: record.priority ?? undefined,
    };
  } else {
    dnsForm.value = { type: 'A', name: '', content: '', ttl: 600 };
  }
  dnsFormShow.value = true;
}

async function handleSubmitDns() {
  if (!selectedAccountId.value || !dnsDrawerDomain.value) return;
  if (!dnsForm.value.type || !dnsForm.value.content) {
    message.warning('类型和值必填');
    return;
  }
  submitting.value = true;
  try {
    const payload: any = {
      type: dnsForm.value.type,
      name: dnsForm.value.name,
      content: dnsForm.value.content,
      ttl: dnsForm.value.ttl,
    };
    if (dnsForm.value.type === 'MX' && dnsForm.value.priority !== undefined) {
      payload.priority = dnsForm.value.priority;
    }
    if (dnsForm.value.id) {
      await domainProvidersApi.updateDnsRecord(selectedAccountId.value, dnsDrawerDomain.value.id, dnsForm.value.id, payload);
      message.success('DNS 记录已更新');
    } else {
      await domainProvidersApi.createDnsRecord(selectedAccountId.value, dnsDrawerDomain.value.id, payload);
      message.success('DNS 记录已添加');
    }
    dnsFormShow.value = false;
    await loadDnsRecords();
  } catch (err: any) {
    message.error(err?.errorMessage || '保存失败');
  } finally {
    submitting.value = false;
  }
}

async function handleDeleteDns(record: DnsheDnsRecord) {
  if (!selectedAccountId.value || !dnsDrawerDomain.value) return;
  try {
    await domainProvidersApi.deleteDnsRecord(selectedAccountId.value, dnsDrawerDomain.value.id, record.id);
    message.success('记录已删除');
    await loadDnsRecords();
  } catch (err: any) {
    message.error(err?.errorMessage || '删除失败');
  }
}

// ===== Columns =====
const accountColumns = computed<DataTableColumns<DomainProviderAccount>>(() => [
  { title: 'ID', key: 'id', width: 60 },
  { title: '名称', key: 'name', width: 160 },
  { title: '状态', key: 'is_active', width: 90, render: (row) =>
    h(NTag, { size: 'small', type: row.is_active ? 'success' : 'default', bordered: false },
      { default: () => row.is_active ? '启用' : '禁用' }) },
  { title: '最后同步', key: 'last_synced', width: 160, render: (row) => row.last_synced ? formatCNShort(row.last_synced) : '-' },
  { title: '最后错误', key: 'last_error', width: 200, ellipsis: { tooltip: true }, render: (row) =>
    row.last_error ? h(NTag, { size: 'small', type: 'error', bordered: false }, { default: () => row.last_error }) : '-' },
  {
    title: '操作', key: 'actions', width: 280, fixed: 'right',
    render: (row) => h(NSpace, { size: 4 }, {
      default: () => [
        h(NButton, { size: 'small', type: 'primary', ghost: row.id === selectedAccountId.value, onClick: () => selectAccount(row.id) },
          { default: () => row.id === selectedAccountId.value ? '已选中' : '选域名' }),
        h(NButton, { size: 'small', onClick: () => handleTestAccount(row.id) }, { default: () => '测试' }),
        h(NButton, { size: 'small', onClick: () => openAccountModal(row) }, { default: () => '编辑' }),
        h(NPopconfirm, { positiveText: '确认删除', negativeText: '取消', positiveButtonProps: { type: 'error' }, onPositiveClick: () => handleDeleteAccount(row.id) }, {
          trigger: () => h(NButton, { size: 'small', type: 'error', ghost: true }, { default: () => '删除' }),
          default: () => `确认删除账号「${row.name}」？此操作不可撤销。`,
        }),
      ],
    }),
  },
]);

const domainColumns = computed<DataTableColumns<DnsheSubdomain>>(() => [
  { title: 'ID', key: 'id', width: 70 },
  { title: '完整域名', key: 'full_domain', width: 220, render: (row) =>
    h(NButton, { size: 'small', text: true, type: 'primary', tag: 'a', href: `https://${row.full_domain}`, target: '_blank' },
      { default: () => row.full_domain }) },
  { title: '子域名', key: 'subdomain', width: 120, ellipsis: { tooltip: true } },
  { title: '根域名', key: 'rootdomain', width: 160, ellipsis: { tooltip: true } },
  { title: '状态', key: 'status', width: 90, render: (row) => {
    const map: Record<string, 'success' | 'warning' | 'error' | 'default'> = { active: 'success', suspended: 'warning', expired: 'error' };
    return h(NTag, { size: 'small', type: map[row.status] || 'default', bordered: false }, { default: () => row.status });
  } },
  { title: '到期时间', key: 'expires_at', width: 170, render: (row) => {
    if (row.never_expires) return h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => '永不过期' });
    if (!row.expires_at) return '-';
    const d = new Date(row.expires_at);
    const days = Math.floor((d.getTime() - Date.now()) / 86400000);
    const urgent = days <= 7;
    const expired = days < 0;
    return h(NTooltip, null, {
      trigger: () => h(NTag, { size: 'small', type: expired ? 'error' : urgent ? 'warning' : 'default', bordered: false },
        { default: () => `${formatCNShort(row.expires_at!)} (${expired ? '已过期' : days + '天'})` }),
      default: () => row.expires_at,
    });
  } },
  { title: '创建时间', key: 'created_at', width: 130, render: (row) => row.created_at ? formatCNShort(row.created_at) : '-' },
  {
    title: '操作', key: 'actions', width: 280, fixed: 'right',
    render: (row) => h(NSpace, { size: 4 }, {
      default: () => [
        h(NButton, { size: 'small', type: 'primary', ghost: true, onClick: () => openDnsDrawer(row) },
          { default: () => 'DNS' }),
        h(NPopconfirm, { positiveText: '确认续期', negativeText: '取消', onPositiveClick: () => handleRenewDomain(row) }, {
          trigger: () => h(NButton, { size: 'small' }, { default: () => '续期' }),
          default: () => '续期将延长 1 年有效期（可能消耗额度）',
        }),
        h(NPopconfirm, { positiveText: '确认删除', negativeText: '取消', positiveButtonProps: { type: 'error' }, onPositiveClick: () => handleDeleteDomain(row) }, {
          trigger: () => h(NButton, { size: 'small', type: 'error', ghost: true }, { default: () => '删除' }),
          default: () => `确认删除域名「${row.full_domain}」？将一并删除其所有 DNS 记录。`,
        }),
      ],
    }),
  },
]);

const dnsColumns = computed<DataTableColumns<DnsheDnsRecord>>(() => [
  { title: 'ID', key: 'id', width: 60 },
  { title: '类型', key: 'type', width: 80, render: (row) => h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => row.type }) },
  { title: '名称', key: 'name', width: 200, ellipsis: { tooltip: true } },
  { title: '值', key: 'content', width: 220, ellipsis: { tooltip: true } },
  { title: 'TTL', key: 'ttl', width: 80 },
  { title: '优先级', key: 'priority', width: 80, render: (r) => r.priority ?? '-' },
  { title: '状态', key: 'status', width: 80, render: (r) => h(NTag, { size: 'small', type: r.status === 'active' ? 'success' : 'default', bordered: false }, { default: () => r.status }) },
  {
    title: '操作', key: 'actions', width: 140, fixed: 'right',
    render: (row) => h(NSpace, { size: 4 }, {
      default: () => [
        h(NButton, { size: 'small', onClick: () => openDnsForm(row) }, { default: () => '编辑' }),
        h(NPopconfirm, { positiveText: '确认删除', negativeText: '取消', positiveButtonProps: { type: 'error' }, onPositiveClick: () => handleDeleteDns(row) }, {
          trigger: () => h(NButton, { size: 'small', type: 'error', ghost: true }, { default: () => '删除' }),
          default: () => '确认删除此 DNS 记录？',
        }),
      ],
    }),
  },
]);

onMounted(() => {
  loadProviders();
});
</script>

<style scoped>
.page-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}
.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
  width: 100%;
}
.provider-card {
  cursor: pointer;
  transition: all 0.15s ease;
}
.provider-card:hover {
  border-color: #18a058;
  box-shadow: 0 2px 8px rgba(24, 160, 88, 0.12);
}
.provider-card--active {
  border-color: #18a058;
  background-color: rgba(24, 160, 88, 0.08);
}
.provider-card--disabled {
  opacity: 0.6;
}
.provider-card__head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.provider-card__name {
  font-weight: 600;
  font-size: 14px;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.provider-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
  color: #999;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.provider-card__code {
  font-family: monospace;
}
.provider-card__region {
  display: inline-flex;
  gap: 2px;
}
.provider-card__capabilities {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

/* ===== Account modal — supply.vue-style ===== */
.account-modal-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.modal-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.modal-section__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--n-text-color, #333);
}
.required-star {
  color: #e03050;
  margin-left: 2px;
}
.modal-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}
.modal-field__help {
  font-size: 11px;
  color: var(--n-text-color-3, #999);
  margin: 0;
}

/* Provider selection grid inside the modal (mirrors supply.vue) */
.provider-select-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--n-border-color, #eee);
  border-radius: 8px;
}
.provider-select-card {
  text-align: left;
  padding: 10px;
  border: 1px solid var(--n-border-color, #ddd);
  border-radius: 8px;
  background: var(--n-color, #fff);
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.provider-select-card:hover {
  border-color: #18a058;
}
.provider-select-card--active {
  border-color: #18a058;
  background: rgba(24, 160, 88, 0.08);
  box-shadow: 0 0 0 1px #18a058;
}
.provider-select-card__head {
  display: flex;
  align-items: center;
  gap: 4px;
}
.provider-select-card__name {
  font-weight: 600;
  font-size: 13px;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.provider-select-card__desc {
  font-size: 11px;
  color: var(--n-text-color-3, #999);
  margin: 0;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.provider-select-card__cap {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

/* Registration flow box — supply.vue's blue panel */
.reg-flow-box {
  background: rgba(56, 142, 235, 0.06);
  border: 1px solid rgba(56, 142, 235, 0.2);
  border-left: 4px solid #388eeb;
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.reg-flow-box__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.reg-flow-box__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #1976d2;
  display: flex;
  align-items: center;
  gap: 4px;
}
.reg-flow-box__actions {
  display: flex;
  gap: 4px;
}
.reg-flow-box__desc {
  font-size: 12px;
  color: var(--n-text-color-2, #555);
  margin: 0;
  line-height: 1.5;
}
.reg-flow-box__model {
  font-size: 12px;
  color: var(--n-text-color-3, #888);
  margin: 0;
}
.reg-flow-box__model-label {
  font-weight: 500;
  margin-right: 4px;
}
.reg-flow-box__steps {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.reg-step {
  display: flex;
  gap: 8px;
}
.reg-step__num {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(56, 142, 235, 0.2);
  color: #1976d2;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.reg-step__body {
  flex: 1;
}
.reg-step__title {
  font-size: 13px;
  font-weight: 500;
  color: var(--n-text-color, #333);
  margin: 0;
}
.reg-step__detail {
  font-size: 12px;
  color: var(--n-text-color-3, #777);
  margin: 2px 0 0;
  line-height: 1.5;
}
</style>
