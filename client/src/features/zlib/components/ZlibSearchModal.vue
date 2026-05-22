<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { BookOpen, Clock, Loader2, Plus, Search, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useRouter } from 'vue-router'
import { api } from '@/lib/api'

interface ZlibBook {
  id: string
  hash: string
  title: string
  author: string
  year: string
  language: string
  extension: string
  filesize: number
  cover: string
}

interface ZlibStatus {
  connected: boolean
  downloadsToday: number
  remainingToday: number
  isAtLimit: boolean
  resetsAt: string | null
}

const emit = defineEmits<{
  close: []
}>()

const router = useRouter()

const query = ref('')
const formatFilter = ref('')
const results = ref<ZlibBook[]>([])
const total = ref(0)
const searching = ref(false)
const searchError = ref<string | null>(null)
const notConnected = ref(false)
const addingId = ref<string | null>(null)
const queuingId = ref<string | null>(null)
const hasSearched = ref(false)
const status = ref<ZlibStatus | null>(null)
const queueCount = ref(0)

let searchTimeout: ReturnType<typeof setTimeout> | null = null

onMounted(fetchStatus)

async function fetchStatus() {
  try {
    const res = await api('/api/v1/zlib/status')
    if (res.ok) {
      status.value = await res.json()
      if (status.value?.isAtLimit) fetchQueueCount()
    }
  } catch {
    // non-critical
  }
}

async function fetchQueueCount() {
  try {
    const res = await api('/api/v1/zlib/queue')
    if (res.ok) {
      const items: { status: string }[] = await res.json()
      queueCount.value = items.filter((i) => i.status === 'pending' || i.status === 'processing').length
    }
  } catch {
    // non-critical
  }
}

function goToQueue() {
  emit('close')
  router.push({ name: 'settings-account' })
}

function formatBytes(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

function formatResetsIn(resetsAt: string): string {
  const diff = new Date(resetsAt).getTime() - Date.now()
  if (diff <= 0) return 'soon'
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

async function doSearch() {
  if (!query.value.trim()) return
  searching.value = true
  searchError.value = null
  notConnected.value = false
  hasSearched.value = true

  try {
    const params = new URLSearchParams({ q: query.value.trim() })
    if (formatFilter.value) params.set('format', formatFilter.value)
    params.set('limit', '20')

    const res = await api(`/api/v1/zlib/search?${params}`)
    if (res.status === 401) {
      notConnected.value = true
      return
    }
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: string } | null
      searchError.value = payload?.message ?? 'Search failed'
      return
    }
    const data: { books: ZlibBook[]; total: number } = await res.json()
    results.value = data.books
    total.value = data.total
  } catch (err) {
    searchError.value = err instanceof Error ? err.message : 'Search failed'
  } finally {
    searching.value = false
  }
}

function onQueryInput() {
  if (searchTimeout) clearTimeout(searchTimeout)
  if (query.value.trim().length >= 2) {
    searchTimeout = setTimeout(doSearch, 600)
  } else {
    results.value = []
    hasSearched.value = false
  }
}

watch(formatFilter, () => {
  if (hasSearched.value) doSearch()
})

async function addToLibrary(book: ZlibBook) {
  addingId.value = book.id
  try {
    const safeName = book.title || 'book'
    const filename = `${safeName.replace(/[^\w\s.-]/g, '').trim()}.${book.extension || 'epub'}`

    const res = await api('/api/v1/zlib/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookId: String(book.id),
        hash: book.hash,
        filename,
        format: book.extension || 'epub',
      }),
    })

    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: string } | null
      toast.error(payload?.message ?? 'Failed to add book')
      return
    }

    const data = await res.json()

    if (data.limitReached) {
      // Auto-queue instead
      await addToQueue(book, true)
      await fetchStatus()
      return
    }

    await fetchStatus()
    toast.success(`"${book.title}" added to Book Dock`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to add book')
  } finally {
    addingId.value = null
  }
}

async function addToQueue(book: ZlibBook, silent = false) {
  queuingId.value = book.id
  try {
    const res = await api('/api/v1/zlib/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookId: String(book.id),
        hash: book.hash,
        title: book.title,
        author: book.author,
        format: book.extension || 'epub',
        cover: book.cover || null,
      }),
    })

    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: string } | null
      toast.error(payload?.message ?? 'Failed to queue book')
      return
    }

    if (silent) {
      toast.info(`Daily limit reached — "${book.title}" queued for tomorrow`)
    } else {
      toast.success(`"${book.title}" added to download queue`)
    }
    fetchQueueCount()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to queue book')
  } finally {
    queuingId.value = null
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  if (e.key === 'Enter') doSearch()
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-[2px]" @click="emit('close')" />

      <div
        class="relative flex flex-col w-full max-w-2xl bg-background rounded-lg shadow-2xl border border-border overflow-hidden"
        style="max-height: min(92vh, 760px)"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div class="flex items-center gap-2">
            <BookOpen :size="16" class="text-muted-foreground" />
            <span class="text-sm font-semibold text-foreground">Search Z-Library</span>
          </div>
          <button
            class="flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            @click="emit('close')"
          >
            <X :size="15" />
          </button>
        </div>

        <!-- Limit banner -->
        <div
          v-if="status?.isAtLimit"
          class="flex items-center justify-between gap-2 px-5 py-2.5 bg-amber-500/10 border-b border-amber-500/20 shrink-0"
        >
          <div class="flex items-center gap-2 min-w-0">
            <Clock :size="13" class="text-amber-600 dark:text-amber-400 shrink-0" />
            <p class="text-xs text-amber-700 dark:text-amber-400 truncate">
              Daily limit reached · resets in {{ status.resetsAt ? formatResetsIn(status.resetsAt) : '24h' }} ·
              {{ queueCount > 0 ? `${queueCount} book${queueCount === 1 ? '' : 's'} queued` : 'books will be queued automatically' }}
            </p>
          </div>
          <button
            class="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400 underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-300 transition-colors"
            @click="goToQueue"
          >
            View queue
          </button>
        </div>

        <!-- Search bar -->
        <div class="px-5 pt-4 pb-3 border-b border-border/50 shrink-0 space-y-2">
          <div class="flex items-center gap-2">
            <div class="relative flex-1">
              <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                v-model="query"
                type="text"
                placeholder="Search by title, author, ISBN..."
                class="w-full h-9 pl-8 pr-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                @input="onQueryInput"
                @keydown="handleKeydown"
              />
            </div>
            <select
              v-model="formatFilter"
              class="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All formats</option>
              <option value="epub">EPUB</option>
              <option value="pdf">PDF</option>
              <option value="mobi">MOBI</option>
              <option value="fb2">FB2</option>
              <option value="azw3">AZW3</option>
            </select>
            <button
              class="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              :disabled="searching || !query.trim()"
              @click="doSearch"
            >
              Search
            </button>
          </div>

          <!-- Download counter -->
          <div v-if="status?.connected && !status.isAtLimit" class="flex justify-end">
            <span class="text-xs text-muted-foreground"> {{ status.remainingToday }} of 10 downloads remaining today </span>
          </div>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-5">
          <!-- Not connected -->
          <div v-if="notConnected" class="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <BookOpen :size="32" class="text-muted-foreground/50" />
            <p class="text-sm font-medium text-foreground">Z-Library not connected</p>
            <p class="text-xs text-muted-foreground">Go to Account Settings → Integrations to connect your Z-Library account.</p>
          </div>

          <!-- Error -->
          <div v-else-if="searchError" class="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {{ searchError }}
          </div>

          <!-- Loading -->
          <div v-else-if="searching" class="flex items-center justify-center py-12 gap-2 text-muted-foreground">
            <Loader2 :size="18" class="animate-spin" />
            <span class="text-sm">Searching...</span>
          </div>

          <!-- Empty state -->
          <div v-else-if="hasSearched && results.length === 0" class="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Search :size="28" class="text-muted-foreground/50" />
            <p class="text-sm text-muted-foreground">No results found</p>
          </div>

          <!-- Prompt to search -->
          <div v-else-if="!hasSearched" class="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Search :size="28" class="text-muted-foreground/50" />
            <p class="text-sm text-muted-foreground">Enter a title or author to search</p>
          </div>

          <!-- Results -->
          <div v-else class="space-y-2">
            <p class="text-xs text-muted-foreground mb-3">{{ total.toLocaleString() }} result{{ total === 1 ? '' : 's' }} found</p>

            <div
              v-for="book in results"
              :key="book.id"
              class="flex items-start gap-3 rounded-md border border-border bg-muted/20 px-3 py-3 hover:bg-muted/40 transition-colors"
            >
              <!-- Cover -->
              <img
                v-if="book.cover"
                :src="`/api/v1/zlib/cover?url=${encodeURIComponent(book.cover)}`"
                :alt="book.title"
                class="w-10 h-14 object-cover rounded shrink-0 bg-muted"
              />
              <div v-else class="w-10 h-14 rounded bg-muted/50 shrink-0 flex items-center justify-center">
                <BookOpen :size="14" class="text-muted-foreground/50" />
              </div>

              <!-- Info -->
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-foreground leading-snug line-clamp-2">{{ book.title }}</p>
                <p class="text-xs text-muted-foreground mt-0.5 truncate">{{ book.author }}</p>
                <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span
                    v-if="book.extension"
                    :class="['inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium uppercase', formatExtClass(book.extension)]"
                  >
                    {{ book.extension }}
                  </span>
                  <span v-if="book.year" class="text-xs text-muted-foreground">{{ book.year }}</span>
                  <span v-if="book.filesize" class="text-xs text-muted-foreground">{{ formatBytes(book.filesize) }}</span>
                  <span v-if="book.language && book.language !== 'english'" class="text-xs text-muted-foreground capitalize">{{
                    book.language
                  }}</span>
                </div>
              </div>

              <!-- Action buttons -->
              <div class="shrink-0 flex flex-col gap-1.5">
                <!-- Download Now (hidden when at limit) -->
                <button
                  v-if="!status?.isAtLimit"
                  type="button"
                  class="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="addingId !== null || queuingId !== null"
                  @click="addToLibrary(book)"
                >
                  <Loader2 v-if="addingId === book.id" :size="12" class="animate-spin" />
                  <Plus v-else :size="12" />
                  {{ addingId === book.id ? 'Adding...' : 'Add' }}
                </button>

                <!-- Queue -->
                <button
                  type="button"
                  class="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="addingId !== null || queuingId !== null"
                  @click="addToQueue(book)"
                >
                  <Loader2 v-if="queuingId === book.id" :size="12" class="animate-spin" />
                  <Clock v-else :size="12" />
                  {{ queuingId === book.id ? 'Queuing...' : 'Queue' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
