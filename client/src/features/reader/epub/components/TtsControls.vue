<script setup lang="ts">
import { computed } from 'vue'
import { Bookmark, Pause, Play, RotateCcw, Settings, SkipBack, SkipForward, Square, Volume2 } from 'lucide-vue-next'
import type { EpubReaderSettings, TtsProvider } from '@bookorbit/types'

const props = defineProps<{
  status: 'idle' | 'loading' | 'speaking' | 'paused' | 'done' | 'error'
  progress: number
  activeIndex: number
  wordCount: number
  provider: TtsProvider | null
  settings: EpubReaderSettings
}>()

const emit = defineEmits<{
  start: []
  pause: []
  resume: []
  stop: []
  replay: []
  skipBack: []
  skipForward: []
  toggleSettings: []
  cycleRate: []
}>()

const providerLabel = computed(() => {
  if (props.provider === 'azure') return 'Azure'
  if (props.provider === 'gcp-chirp3') return 'Google'
  if (props.provider === 'xai') return 'xAI'
  if (props.provider === 'kokoro') return 'Kokoro'
  if (props.provider === 'gpt-4o-mini-tts') return 'GPT'
  return 'Device'
})

const progressLabel = computed(() => {
  if (props.wordCount <= 0 || props.activeIndex < 0) return 'Ready'
  return `${Math.min(props.wordCount, props.activeIndex + 1)} / ${props.wordCount}`
})

const canPause = computed(() => props.status === 'speaking' || props.status === 'loading')
const canResume = computed(() => props.status === 'paused')
const canReplay = computed(() => props.status === 'done' || props.status === 'error')
</script>

<template>
  <div class="fixed inset-x-0 bottom-0 z-[60] bg-[#0f0f0f]/95 text-white shadow-2xl backdrop-blur-md border-t border-white/10">
    <div class="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-3 sm:px-6">
      <div class="flex items-center gap-3">
        <span class="w-14 shrink-0 text-xs tabular-nums text-white/45">{{ progressLabel }}</span>
        <div class="relative h-2 flex-1 overflow-hidden rounded-full bg-white/12">
          <div class="absolute inset-y-0 left-0 rounded-full bg-white transition-[width]" :style="{ width: `${progress * 100}%` }" />
        </div>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-xs font-medium text-white/65 hover:bg-white/10 hover:text-white"
          aria-label="Change speech speed"
          @click="emit('cycleRate')"
        >
          {{ settings.ttsRate.toFixed(1) }}x
        </button>
      </div>

      <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div class="flex items-center gap-2">
          <button type="button" class="tts-toolbar-btn hidden sm:inline-flex" aria-label="Bookmark current position">
            <Bookmark :size="22" />
          </button>
          <button type="button" class="tts-toolbar-chip" aria-label="TTS engine" @click="emit('toggleSettings')">
            <Volume2 :size="16" />
            <span>{{ providerLabel }}</span>
          </button>
        </div>

        <div class="flex items-center justify-center gap-3">
          <button type="button" class="tts-toolbar-btn" :aria-label="`Skip back ${settings.ttsSkipBackSeconds} seconds`" @click="emit('skipBack')">
            <SkipBack :size="24" />
            <span class="sr-only">{{ settings.ttsSkipBackSeconds }}</span>
          </button>

          <button v-if="canPause" type="button" class="tts-toolbar-play" aria-label="Pause TTS" @click="emit('pause')">
            <Pause :size="34" fill="currentColor" />
          </button>
          <button v-else-if="canResume" type="button" class="tts-toolbar-play" aria-label="Resume TTS" @click="emit('resume')">
            <Play :size="34" fill="currentColor" />
          </button>
          <button v-else-if="canReplay" type="button" class="tts-toolbar-play" aria-label="Replay TTS" @click="emit('replay')">
            <RotateCcw :size="30" />
          </button>
          <button v-else type="button" class="tts-toolbar-play" aria-label="Start TTS" @click="emit('start')">
            <Play :size="34" fill="currentColor" />
          </button>

          <button
            type="button"
            class="tts-toolbar-btn"
            :aria-label="`Skip forward ${settings.ttsSkipForwardSeconds} seconds`"
            @click="emit('skipForward')"
          >
            <SkipForward :size="24" />
            <span class="sr-only">{{ settings.ttsSkipForwardSeconds }}</span>
          </button>
        </div>

        <div class="flex items-center justify-end gap-2">
          <button type="button" class="tts-toolbar-btn" aria-label="TTS settings" @click="emit('toggleSettings')">
            <Settings :size="22" />
          </button>
          <button type="button" class="tts-toolbar-btn" aria-label="Stop TTS" @click="emit('stop')">
            <Square :size="21" fill="currentColor" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
