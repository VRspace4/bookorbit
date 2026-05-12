<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { Smartphone, AlertTriangle } from 'lucide-vue-next'
import type { KoreaderBookSyncInfo } from '@bookorbit/types'
import { useKoreaderBookProgress } from '@/features/koreader/composables/useKoreaderBookProgress'

const props = defineProps<{ bookId: number; bookProgress?: KoreaderBookSyncInfo | null }>()
const { bookProgress: fetchedProgress, loading, fetchBookProgress } = useKoreaderBookProgress()
const displayProgress = computed(() => props.bookProgress ?? fetchedProgress.value)
const isLoading = computed(() => (props.bookProgress === undefined ? loading.value : false))

onMounted(() => {
  if (props.bookProgress === undefined) {
    fetchBookProgress(props.bookId)
  }
})

watch(
  () => props.bookId,
  (newId) => {
    if (props.bookProgress === undefined) {
      fetchBookProgress(newId)
    }
  },
)

function formatPercentage(pct: number): string {
  return `${Math.round(pct)}%`
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <div v-if="!isLoading && displayProgress" class="border border-border rounded-lg bg-card shadow-xs overflow-hidden">
    <div class="px-4 py-3 border-b border-border flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Smartphone :size="14" class="text-muted-foreground" />
        <span class="text-xs font-medium text-foreground">KOReader Sync</span>
      </div>
      <div v-if="displayProgress.fileModifiedSinceLastSync" class="flex items-center gap-1 text-amber-500">
        <AlertTriangle :size="12" />
        <span class="text-[10px] font-medium">File modified</span>
      </div>
    </div>
    <div class="px-4 py-3 space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">Progress</span>
        <span class="text-xs font-medium text-foreground">{{ formatPercentage(displayProgress.canonicalPercentage) }}</span>
      </div>
      <div class="w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div class="h-full bg-primary rounded-full transition-all" :style="{ width: `${displayProgress.canonicalPercentage}%` }" />
      </div>
      <div v-if="displayProgress.canonicalChapterTitle" class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">Chapter</span>
        <span class="text-xs text-foreground truncate max-w-[60%]">{{ displayProgress.canonicalChapterTitle }}</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">Source</span>
        <span class="text-xs text-foreground">{{ displayProgress.canonicalSource === 'koreader' ? 'KOReader' : 'Web Reader' }}</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">Updated</span>
        <span class="text-xs text-foreground">{{ formatDate(displayProgress.canonicalUpdatedAt) }}</span>
      </div>

      <!-- Per-device breakdown -->
      <div v-if="displayProgress.devices.length > 1" class="pt-2 border-t border-border space-y-1.5">
        <p class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Devices</p>
        <div v-for="device in displayProgress.devices" :key="device.deviceId" class="flex items-center justify-between text-xs">
          <span class="text-muted-foreground truncate max-w-[40%]">{{ device.device }}</span>
          <span class="text-foreground">{{ formatPercentage(device.percentage) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
