<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BookOpen, Clock, Loader2, RefreshCw, Trash2, CheckCircle2, XCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'

interface QueueItem {
  id: number
  title: string
  author: string
  extension: string
  cover: string | null
  status: 'pending' | 'processing' | 'completed' | 'failed'
  errorMessage: string | null
  bookDockId: number | null
  queuePosition: number | null
  createdAt: string
  processedAt: string | null
}

const items = ref<QueueItem[]>([])
const loading = ref(false)
const removingId = ref<number | null>(null)
const retryingId = ref<number | null>(null)
const running = ref(false)

const pending = computed(() => items.value.filter((i) => i.status === 'pending' || i.status === 'processing'))
const completed = computed(() => items.value.filter((i) => i.status === 'completed'))
const failed = computed(() => items.value.filter((i) => i.status === 'failed'))

onMounted(fetchQueue)

async function fetchQueue() {
  loading.value = true
  try {
    const res = await api('/api/v1/zlib/queue')
    if (res.ok) items.value = await res.json()
  } catch {
    // ignore
  } finally {
    loading.value = false
  }
}

async function remove(item: QueueItem) {
  removingId.value = item.id
  try {
    await api(`/api/v1/zlib/queue/${item.id}`, { method: 'DELETE' })
    items.value = items.value.filter((i) => i.id !== item.id)
  } catch {
    toast.error('Failed to remove item')
  } finally {
    removingId.value = null
  }
}

async function runNow() {
  running.value = true
  try {
    await api('/api/v1/zlib/queue/run', { method: 'POST' })
    setTimeout(fetchQueue, 2000)
  } catch {
    // ignore
  } finally {
    running.value = false
  }
}

async function retry(item: QueueItem) {
  retryingId.value = item.id
  try {
    await api(`/api/v1/zlib/queue/${item.id}/retry`, { method: 'POST' })
    await fetchQueue()
    toast.success('Queued for retry')
  } catch {
    toast.error('Failed to retry')
  } finally {
    retryingId.value = null
  }
}

function formatExtClass(ext: string): string {
  const map: Record<string, string> = {
    epub: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    pdf: 'bg-red-500/15 text-red-600 dark:text-red-400',
    mobi: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    azw3: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    fb2: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  }
  return map[ext?.toLowerCase()] ?? 'bg-muted text-muted-foreground/85'
}

function estimatedDays(position: number): string {
  const days = Math.ceil(position / 10)
  if (days <= 1) return 'today or tomorrow'
  return `~${days} days`
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-sm font-semibold text-foreground">Download Queue</h3>
        <p class="text-xs text-muted-foreground mt-0.5">Books queued for automatic download (up to 10/day)</p>
      </div>
      <div class="flex items-center gap-1.5">
        <button
          class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
          :disabled="loading"
          @click="fetchQueue"
        >
          <Loader2 v-if="loading" :size="13" class="animate-spin" />
          <RefreshCw v-else :size="13" />
          Refresh
        </button>
        <button
          v-if="pending.length > 0"
          class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
          :disabled="running"
          @click="runNow"
        >
          <Loader2 v-if="running" :size="13" class="animate-spin" />
          <RefreshCw v-else :size="13" />
          {{ running ? 'Running...' : 'Run Now' }}
        </button>
      </div>
    </div>

    <!-- Empty -->
    <div v-if="!loading && items.length === 0" class="flex flex-col items-center gap-2 py-8 text-center">
      <Clock :size="28" class="text-muted-foreground/40" />
      <p class="text-sm text-muted-foreground">No books in queue</p>
      <p class="text-xs text-muted-foreground/70">Use "Queue" in the Z-Library search to add books</p>
    </div>

    <!-- Pending / Processing -->
    <div v-if="pending.length > 0">
      <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Pending ({{ pending.length }})</p>
      <div class="space-y-2">
        <div v-for="item in pending" :key="item.id" class="flex items-center gap-3 rounded-md border border-border bg-muted/20 px-3 py-2.5">
          <!-- Cover -->
          <img
            v-if="item.cover"
            :src="`/api/v1/zlib/cover?url=${encodeURIComponent(item.cover)}`"
            :alt="item.title"
            class="w-8 h-11 object-cover rounded shrink-0 bg-muted"
          />
          <div v-else class="w-8 h-11 rounded bg-muted/50 shrink-0 flex items-center justify-center">
            <BookOpen :size="12" class="text-muted-foreground/50" />
          </div>

          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-foreground truncate">{{ item.title }}</p>
            <p class="text-xs text-muted-foreground truncate">{{ item.author }}</p>
            <div class="flex items-center gap-2 mt-1">
              <span :class="['inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium uppercase', formatExtClass(item.extension)]">
                {{ item.extension }}
              </span>
              <span v-if="item.status === 'processing'" class="flex items-center gap-1 text-xs text-primary">
                <Loader2 :size="10" class="animate-spin" />
                Downloading...
              </span>
              <span v-else-if="item.queuePosition" class="text-xs text-muted-foreground">
                #{{ item.queuePosition }} · {{ estimatedDays(item.queuePosition) }}
              </span>
            </div>
          </div>

          <button
            v-if="item.status === 'pending'"
            class="shrink-0 p-1.5 rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
            :disabled="removingId === item.id"
            @click="remove(item)"
          >
            <Loader2 v-if="removingId === item.id" :size="14" class="animate-spin" />
            <Trash2 v-else :size="14" />
          </button>
        </div>
      </div>
    </div>

    <!-- Failed -->
    <div v-if="failed.length > 0">
      <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Failed ({{ failed.length }})</p>
      <div class="space-y-2">
        <div
          v-for="item in failed"
          :key="item.id"
          class="flex items-center gap-3 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5"
        >
          <XCircle :size="16" class="text-destructive shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-foreground truncate">{{ item.title }}</p>
            <p v-if="item.errorMessage" class="text-xs text-destructive/80 truncate mt-0.5">{{ item.errorMessage }}</p>
          </div>
          <div class="shrink-0 flex gap-1.5">
            <button
              class="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
              :disabled="retryingId === item.id"
              @click="retry(item)"
            >
              <Loader2 v-if="retryingId === item.id" :size="11" class="animate-spin" />
              <RefreshCw v-else :size="11" />
              Retry
            </button>
            <button
              class="p-1.5 rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
              :disabled="removingId === item.id"
              @click="remove(item)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Completed -->
    <div v-if="completed.length > 0">
      <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Downloaded ({{ completed.length }})</p>
      <div class="space-y-2">
        <div
          v-for="item in completed"
          :key="item.id"
          class="flex items-center gap-3 rounded-md border border-border bg-muted/10 px-3 py-2.5 opacity-75"
        >
          <CheckCircle2 :size="16" class="text-green-500 shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-foreground truncate">{{ item.title }}</p>
            <p class="text-xs text-muted-foreground truncate">{{ item.author }}</p>
          </div>
          <button
            class="shrink-0 p-1.5 rounded text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted transition-colors"
            :disabled="removingId === item.id"
            @click="remove(item)"
          >
            <Trash2 :size="14" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
