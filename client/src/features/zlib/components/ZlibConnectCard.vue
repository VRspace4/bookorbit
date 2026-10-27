<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { onMounted, ref } from 'vue'
import { BookOpen, Link } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { SECRET_INPUT_ATTRS } from '@/lib/secret-input'

const connected = ref(false)
const connectedEmail = ref<string | null>(null)
const loading = ref(false)
const formEmail = ref('')
const formPassword = ref('')
const saving = ref(false)
const showForm = ref(false)

async function fetchStatus() {
  loading.value = true
  try {
    const res = await api('/api/v1/zlib/status')
    if (res.ok) {
      const data: { connected: boolean; email?: string } = await res.json()
      connected.value = data.connected
      connectedEmail.value = data.email ?? null
    }
  } finally {
    loading.value = false
  }
}

async function connect() {
  if (!formEmail.value || !formPassword.value) return
  saving.value = true
  try {
    const res = await api('/api/v1/zlib/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: formEmail.value, password: formPassword.value }),
    })
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null
      const message = Array.isArray(payload?.message) ? (payload.message[0] ?? 'Failed to connect') : (payload?.message ?? 'Invalid credentials')
      toast.error(message)
      return
    }
    const data: { connected: boolean; email?: string } = await res.json()
    connected.value = data.connected
    connectedEmail.value = data.email ?? formEmail.value
    formEmail.value = ''
    formPassword.value = ''
    showForm.value = false
    toast.success('Z-Library connected')
  } finally {
    saving.value = false
  }
}

async function disconnect() {
  saving.value = true
  try {
    const res = await api('/api/v1/zlib/connect', { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Failed to disconnect')
      return
    }
    connected.value = false
    connectedEmail.value = null
    toast.success('Z-Library disconnected')
  } finally {
    saving.value = false
  }
}

onMounted(fetchStatus)
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-4 md:p-5 space-y-3 shadow-xs">
    <div class="flex items-center gap-2">
      <BookOpen class="h-4 w-4 text-muted-foreground shrink-0" />
      <h2 class="text-sm font-semibold text-foreground">Z-Library</h2>
    </div>

    <div v-if="loading" class="text-sm text-muted-foreground">Loading...</div>

    <template v-else-if="connected">
      <div class="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
        <Link class="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-foreground">Connected</p>
          <p class="text-xs text-muted-foreground truncate">{{ connectedEmail }}</p>
        </div>
        <button
          type="button"
          :disabled="saving"
          class="shrink-0 rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          @click="disconnect"
        >
          Disconnect
        </button>
      </div>
    </template>

    <template v-else>
      <p class="text-xs text-muted-foreground">Connect your Z-Library account to search and add ebooks directly to your library.</p>

      <div v-if="!showForm">
        <Button type="button" variant="outline" @click="showForm = true">
          <Link class="h-3.5 w-3.5" />
          Connect Z-Library
        </Button>
      </div>

      <div v-else class="space-y-3">
        <div class="space-y-1.5">
          <label class="settings-label">Z-Library email</label>
          <input
            v-model="formEmail"
            type="email"
            placeholder="your@email.com"
            autocomplete="username"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div class="space-y-1.5">
          <label class="settings-label">Password</label>
          <input
            v-model="formPassword"
            v-bind="SECRET_INPUT_ATTRS"
            type="text"
            placeholder="••••••••"
            class="input-secret w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div class="flex items-center gap-2">
          <Button type="button" :disabled="saving || !formEmail || !formPassword" @click="connect">
            <Link class="h-3.5 w-3.5" />
            {{ saving ? 'Connecting...' : 'Connect' }}
          </Button>
          <Button type="button" variant="outline" :disabled="saving" @click="showForm = false">Cancel</Button>
        </div>
      </div>
    </template>
  </section>
</template>
