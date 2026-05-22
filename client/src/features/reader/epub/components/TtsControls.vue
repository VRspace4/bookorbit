<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Bookmark, ChevronDown, ChevronUp, Loader2, Pause, Play, RotateCcw, Settings, SkipBack, SkipForward, Volume2 } from 'lucide-vue-next'
import type { EpubReaderSettings, TtsProvider } from '@bookorbit/types'
import { CLOUD_TTS_PROVIDERS, resolveCloudTtsProvider, ttsProviderLabel } from '../tts/tts-provider-display'

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
  prefetch: []
  pause: []
  resume: []
  replay: []
  skipBack: []
  skipForward: []
  toggleSettings: []
  updateProvider: [provider: TtsProvider]
  updateRate: [rate: number]
}>()

/** Toolbar chip reflects the selected engine, not a stale runtime snapshot. */
const displayProvider = computed(() => resolveCloudTtsProvider(null, props.settings.ttsProvider))

const providerLabel = computed(() => ttsProviderLabel(displayProvider.value))

const TTS_RATE_OPTIONS = Array.from({ length: 9 }, (_, index) => 1 + index * 0.25)

const showEnginePicker = ref(false)
const showSpeedPicker = ref(false)
const engineButtonRef = ref<HTMLElement | null>(null)
const speedButtonRef = ref<HTMLElement | null>(null)
const enginePopoverStyle = ref<Record<string, string>>({})
const speedPopoverStyle = ref<Record<string, string>>({})

const isLoading = computed(() => props.status === 'loading')
const canPause = computed(() => props.status === 'speaking')
const canResume = computed(() => props.status === 'paused')
const canReplay = computed(() => props.status === 'done' || props.status === 'error')

function closePickers() {
  showEnginePicker.value = false
  showSpeedPicker.value = false
}

function positionPopover(button: HTMLElement | null, popoverWidth: number, styleRef: typeof enginePopoverStyle) {
  if (!button) return
  const rect = button.getBoundingClientRect()
  const left = Math.max(12, Math.min(window.innerWidth - popoverWidth - 12, rect.left + rect.width / 2 - popoverWidth / 2))
  styleRef.value = {
    top: `${rect.top}px`,
    left: `${left}px`,
    width: `${popoverWidth}px`,
    transform: 'translateY(calc(-100% - 8px))',
  }
}

async function openEnginePicker() {
  showSpeedPicker.value = false
  if (showEnginePicker.value) {
    showEnginePicker.value = false
    return
  }
  await nextTick()
  positionPopover(engineButtonRef.value, 200, enginePopoverStyle)
  // Defer so the opening tap does not hit the backdrop in the same gesture.
  requestAnimationFrame(() => {
    showEnginePicker.value = true
  })
}

async function openSpeedPicker() {
  showEnginePicker.value = false
  if (showSpeedPicker.value) {
    showSpeedPicker.value = false
    return
  }
  await nextTick()
  positionPopover(speedButtonRef.value, 132, speedPopoverStyle)
  requestAnimationFrame(() => {
    showSpeedPicker.value = true
  })
}

function isRateSelected(rate: number) {
  return Math.abs(props.settings.ttsRate - rate) < 0.01
}

function formatRate(rate: number) {
  return `${rate.toFixed(2).replace(/\.?0+$/, '')}x`
}

function selectProvider(provider: TtsProvider) {
  emit('updateProvider', provider)
  closePickers()
}

function selectRate(rate: number) {
  emit('updateRate', rate)
  closePickers()
}
</script>

<template>
  <div
    class="fixed inset-x-0 bottom-0 z-[60] border-t border-white/10 bg-[#0f0f0f]/95 text-white shadow-2xl backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
  >
    <div class="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-1 px-2 pt-1 pb-1.5 sm:gap-1.5 sm:px-4 sm:pb-2 sm:pt-1">
      <div class="h-1 overflow-hidden rounded-full bg-white/12">
        <div class="h-full rounded-full bg-white transition-[width]" :style="{ width: `${progress * 100}%` }" />
      </div>

      <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 sm:gap-2">
        <div class="flex min-w-0 items-center gap-1 sm:gap-2">
          <button type="button" class="tts-toolbar-btn hidden sm:inline-flex" aria-label="Bookmark current position">
            <Bookmark :size="22" />
          </button>
          <button
            ref="engineButtonRef"
            type="button"
            class="tts-toolbar-chip min-w-0 max-w-full"
            :class="showEnginePicker ? 'bg-white/15 text-white' : ''"
            aria-label="Choose TTS engine"
            aria-haspopup="listbox"
            :aria-expanded="showEnginePicker"
            @click="openEnginePicker"
          >
            <Volume2 :size="16" class="shrink-0" />
            <span class="truncate sm:max-w-none">{{ providerLabel }}</span>
            <ChevronUp v-if="showEnginePicker" :size="14" class="shrink-0 text-white/55" />
            <ChevronDown v-else :size="14" class="shrink-0 text-white/55" />
          </button>
        </div>

        <div class="flex shrink-0 items-center justify-center gap-0.5 sm:gap-3">
          <button type="button" class="tts-toolbar-btn" :aria-label="`Skip back ${settings.ttsSkipBackSeconds} seconds`" @click="emit('skipBack')">
            <SkipBack class="tts-toolbar-icon" />
            <span class="sr-only">{{ settings.ttsSkipBackSeconds }}</span>
          </button>

          <button v-if="isLoading" type="button" class="tts-toolbar-play pointer-events-none opacity-70" aria-label="Loading TTS" disabled>
            <Loader2 class="tts-toolbar-play-icon animate-spin" />
          </button>
          <button v-else-if="canPause" type="button" class="tts-toolbar-play" aria-label="Pause TTS" @click="emit('pause')">
            <Pause class="tts-toolbar-play-icon" fill="currentColor" />
          </button>
          <button v-else-if="canResume" type="button" class="tts-toolbar-play" aria-label="Resume TTS" @click="emit('resume')">
            <Play class="tts-toolbar-play-icon" fill="currentColor" />
          </button>
          <button v-else-if="canReplay" type="button" class="tts-toolbar-play" aria-label="Replay TTS" @click="emit('replay')">
            <RotateCcw class="tts-toolbar-play-icon-sm" />
          </button>
          <button
            v-else
            type="button"
            class="tts-toolbar-play"
            aria-label="Start TTS"
            @pointerenter="emit('prefetch')"
            @focus="emit('prefetch')"
            @click="emit('start')"
          >
            <Play class="tts-toolbar-play-icon" fill="currentColor" />
          </button>

          <button
            type="button"
            class="tts-toolbar-btn"
            :aria-label="`Skip forward ${settings.ttsSkipForwardSeconds} seconds`"
            @click="emit('skipForward')"
          >
            <SkipForward class="tts-toolbar-icon" />
            <span class="sr-only">{{ settings.ttsSkipForwardSeconds }}</span>
          </button>
        </div>

        <div class="flex min-w-0 items-center justify-end gap-0.5 sm:gap-2">
          <button
            ref="speedButtonRef"
            type="button"
            class="tts-toolbar-speed shrink-0"
            :class="showSpeedPicker ? 'bg-white/15 text-white' : ''"
            aria-label="Choose reading speed"
            aria-haspopup="listbox"
            :aria-expanded="showSpeedPicker"
            @click="openSpeedPicker"
          >
            <span class="text-xs font-bold tabular-nums leading-none sm:text-sm">{{ formatRate(settings.ttsRate) }}</span>
            <span class="hidden items-center gap-0.5 text-[10px] font-medium tracking-wide text-white/55 sm:flex">
              Speed
              <ChevronUp v-if="showSpeedPicker" :size="12" />
              <ChevronDown v-else :size="12" />
            </span>
          </button>
          <button type="button" class="tts-toolbar-btn shrink-0" aria-label="TTS settings" @click="emit('toggleSettings')">
            <Settings class="tts-toolbar-icon" />
          </button>
        </div>
      </div>
    </div>

    <!-- Teleport escapes ReaderView overflow-hidden so pickers are visible -->
    <Teleport to="body">
      <div v-if="showEnginePicker" class="fixed inset-0 z-[80]" @click="closePickers">
        <div class="absolute inset-0 bg-black/45" aria-hidden="true" />

        <div
          class="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border border-white/10 bg-[#141414] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-2xl sm:hidden"
          role="listbox"
          aria-label="TTS engines"
          @click.stop
        >
          <p class="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-white/50">Engine</p>
          <div class="flex flex-col gap-0.5">
            <button
              v-for="provider in CLOUD_TTS_PROVIDERS"
              :key="provider"
              type="button"
              role="option"
              class="rounded-lg px-3 py-3 text-left text-sm font-medium transition-colors"
              :class="displayProvider === provider ? 'bg-white/15 text-white' : 'text-white/70 active:bg-white/10'"
              :aria-selected="displayProvider === provider"
              @click="selectProvider(provider)"
            >
              {{ ttsProviderLabel(provider) }}
            </button>
          </div>
        </div>

        <div
          class="absolute hidden rounded-2xl border border-white/10 bg-black/90 p-2 shadow-2xl backdrop-blur-xl sm:block"
          role="listbox"
          aria-label="TTS engines"
          :style="enginePopoverStyle"
          @click.stop
        >
          <p class="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/50">Engine</p>
          <div class="flex flex-col gap-0.5">
            <button
              v-for="provider in CLOUD_TTS_PROVIDERS"
              :key="provider"
              type="button"
              role="option"
              class="rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors"
              :class="displayProvider === provider ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'"
              :aria-selected="displayProvider === provider"
              @click="selectProvider(provider)"
            >
              {{ ttsProviderLabel(provider) }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showSpeedPicker" class="fixed inset-0 z-[80]" @click="closePickers">
        <div class="absolute inset-0 bg-black/45" aria-hidden="true" />

        <div
          class="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border border-white/10 bg-[#141414] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-2xl sm:hidden"
          role="listbox"
          aria-label="Reading speed"
          @click.stop
        >
          <p class="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-white/50">Speed</p>
          <div class="grid grid-cols-3 gap-1.5">
            <button
              v-for="rate in TTS_RATE_OPTIONS"
              :key="rate"
              type="button"
              role="option"
              class="rounded-lg px-2 py-3 text-center text-sm font-medium tabular-nums transition-colors"
              :class="isRateSelected(rate) ? 'bg-white/15 text-white' : 'text-white/70 active:bg-white/10'"
              :aria-selected="isRateSelected(rate)"
              @click="selectRate(rate)"
            >
              {{ formatRate(rate) }}
            </button>
          </div>
        </div>

        <div
          class="absolute hidden max-h-[min(18rem,calc(100vh-6rem))] overflow-y-auto rounded-2xl border border-white/10 bg-black/90 p-2 shadow-2xl backdrop-blur-xl sm:block"
          role="listbox"
          aria-label="Reading speed"
          :style="speedPopoverStyle"
          @click.stop
        >
          <p class="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/50">Speed</p>
          <div class="flex flex-col gap-0.5">
            <button
              v-for="rate in TTS_RATE_OPTIONS"
              :key="rate"
              type="button"
              role="option"
              class="rounded-lg px-3 py-2 text-left text-sm font-medium tabular-nums transition-colors"
              :class="isRateSelected(rate) ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'"
              :aria-selected="isRateSelected(rate)"
              @click="selectRate(rate)"
            >
              {{ formatRate(rate) }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
