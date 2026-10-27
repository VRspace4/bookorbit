<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { GripVertical, Pipette, X } from '@lucide/vue'
import { hexToHsl, hslToHex, normalizeHex, type HslColor } from '../lib/color-utils'

const props = defineProps<{
  target: 'sentence' | 'word'
  sentenceColor: string
  wordColor: string
}>()

const emit = defineEmits<{
  close: []
  'update:target': [target: 'sentence' | 'word']
  update: [patch: { ttsSentenceHighlightColor?: string; ttsWordHighlightColor?: string }]
}>()

const panelRef = ref<HTMLElement | null>(null)
const slPickerRef = ref<HTMLElement | null>(null)
const huePickerRef = ref<HTMLElement | null>(null)
const position = ref({ x: 0, y: 0 })
const dragOffset = ref({ x: 0, y: 0 })
const hexInput = ref('')
const hsl = ref<HslColor>({ h: 0, s: 50, l: 50 })
const draggingPanel = ref(false)
const draggingSl = ref(false)
const draggingHue = ref(false)
const activeDragPointerId = ref<number | null>(null)
const showPresetColors = ref(false)
const showCustomPicker = ref(true)

const PRESET_COLORS = [
  { hex: '#fde68a', label: 'Yellow' },
  { hex: '#4f6f7d', label: 'Slate' },
  { hex: '#0f4f5f', label: 'Teal' },
  { hex: '#93c5fd', label: 'Blue' },
  { hex: '#86efac', label: 'Green' },
  { hex: '#fca5a5', label: 'Red' },
  { hex: '#fdba74', label: 'Orange' },
  { hex: '#c4b5fd', label: 'Purple' },
] as const

const currentColor = computed(() => (props.target === 'sentence' ? props.sentenceColor : props.wordColor))
const otherTargetColor = computed(() => (props.target === 'sentence' ? props.wordColor : props.sentenceColor))
const copyFromOtherLabel = computed(() => (props.target === 'sentence' ? 'Copy color from Word highlight' : 'Copy color from Sentence highlight'))
const slBackground = computed(() => `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsl.value.h} 100% 50%))`)

function clamp(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function clampPosition(next: { x: number; y: number }) {
  const panelWidth = panelRef.value?.offsetWidth ?? 216
  const panelHeight = panelRef.value?.offsetHeight ?? 320
  return {
    x: clamp(next.x, 8, window.innerWidth - panelWidth - 8),
    y: clamp(next.y, 8, window.innerHeight - panelHeight - 8),
  }
}

function setInitialPosition() {
  const panelWidth = panelRef.value?.offsetWidth ?? 216
  position.value = clampPosition({
    x: window.innerWidth - panelWidth - 16,
    y: window.innerHeight - 360,
  })
}

function updatePanelPosition(clientX: number, clientY: number) {
  position.value = clampPosition({
    x: clientX - dragOffset.value.x,
    y: clientY - dragOffset.value.y,
  })
}

function onDocumentPanelDragMove(event: PointerEvent) {
  if (!draggingPanel.value || event.pointerId !== activeDragPointerId.value) return
  event.preventDefault()
  updatePanelPosition(event.clientX, event.clientY)
}

function stopPanelDrag() {
  draggingPanel.value = false
  activeDragPointerId.value = null
  document.removeEventListener('pointermove', onDocumentPanelDragMove)
  document.removeEventListener('pointerup', onDocumentPanelDragEnd)
  document.removeEventListener('pointercancel', onDocumentPanelDragEnd)
}

function onDocumentPanelDragEnd(event: PointerEvent) {
  if (!draggingPanel.value || event.pointerId !== activeDragPointerId.value) return
  stopPanelDrag()
}

function onDragStart(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('button')) return
  event.preventDefault()
  draggingPanel.value = true
  activeDragPointerId.value = event.pointerId
  dragOffset.value = {
    x: event.clientX - position.value.x,
    y: event.clientY - position.value.y,
  }
  document.addEventListener('pointermove', onDocumentPanelDragMove)
  document.addEventListener('pointerup', onDocumentPanelDragEnd)
  document.addEventListener('pointercancel', onDocumentPanelDragEnd)
  updatePanelPosition(event.clientX, event.clientY)
}

function emitColor(color: string) {
  const normalized = normalizeHex(color)
  if (!normalized) return
  hexInput.value = normalized
  emit('update', props.target === 'sentence' ? { ttsSentenceHighlightColor: normalized } : { ttsWordHighlightColor: normalized })
}

function syncHslFromHex(hex: string) {
  const parsed = hexToHsl(hex)
  if (parsed) hsl.value = parsed
}

function updateFromHsl() {
  emitColor(hslToHex(hsl.value.h, hsl.value.s, hsl.value.l))
}

function updateSlFromPointer(event: PointerEvent) {
  const picker = slPickerRef.value
  if (!picker) return
  const rect = picker.getBoundingClientRect()
  const x = clamp((event.clientX - rect.left) / rect.width, 0, 1)
  const y = clamp((event.clientY - rect.top) / rect.height, 0, 1)
  hsl.value = {
    ...hsl.value,
    s: x * 100,
    l: (1 - y) * 100,
  }
  updateFromHsl()
}

function updateHueFromPointer(event: PointerEvent) {
  const picker = huePickerRef.value
  if (!picker) return
  const rect = picker.getBoundingClientRect()
  const x = clamp((event.clientX - rect.left) / rect.width, 0, 1)
  hsl.value = {
    ...hsl.value,
    h: x * 360,
  }
  updateFromHsl()
}

function onSlPointerDown(event: PointerEvent) {
  event.preventDefault()
  event.stopPropagation()
  draggingSl.value = true
  slPickerRef.value?.setPointerCapture(event.pointerId)
  updateSlFromPointer(event)
}

function onSlPointerMove(event: PointerEvent) {
  if (!draggingSl.value) return
  updateSlFromPointer(event)
}

function onSlPointerEnd(event: PointerEvent) {
  if (!draggingSl.value) return
  draggingSl.value = false
  slPickerRef.value?.releasePointerCapture(event.pointerId)
}

function onHuePointerDown(event: PointerEvent) {
  event.preventDefault()
  event.stopPropagation()
  draggingHue.value = true
  huePickerRef.value?.setPointerCapture(event.pointerId)
  updateHueFromPointer(event)
}

function onHuePointerMove(event: PointerEvent) {
  if (!draggingHue.value) return
  updateHueFromPointer(event)
}

function onHuePointerEnd(event: PointerEvent) {
  if (!draggingHue.value) return
  draggingHue.value = false
  huePickerRef.value?.releasePointerCapture(event.pointerId)
}

function onHexInput(event: Event) {
  hexInput.value = (event.target as HTMLInputElement).value
}

function onHexCommit() {
  const normalized = normalizeHex(hexInput.value)
  if (normalized) {
    syncHslFromHex(normalized)
    emitColor(normalized)
    return
  }
  hexInput.value = currentColor.value
}

function onTargetClick(next: 'sentence' | 'word') {
  if (props.target === next) {
    showPresetColors.value = !showPresetColors.value
    return
  }
  emit('update:target', next)
}

function toggleCustomPicker() {
  showCustomPicker.value = !showCustomPicker.value
}

function copyFromOtherTarget() {
  emitColor(otherTargetColor.value)
}

watch(
  () => currentColor.value,
  (color) => {
    hexInput.value = color
    syncHslFromHex(color)
  },
  { immediate: true },
)

onMounted(setInitialPosition)
onUnmounted(stopPanelDrag)
</script>

<template>
  <Teleport to="body">
    <div v-if="draggingPanel" class="fixed inset-0 z-[74] touch-none" aria-hidden="true" />

    <div
      ref="panelRef"
      class="fixed z-[75] w-[13.5rem] select-none rounded-lg border border-border bg-card text-card-foreground shadow-2xl"
      :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      @mousedown.stop
    >
      <div
        class="flex cursor-grab touch-none items-center gap-1.5 border-b border-border px-2 py-1.5 active:cursor-grabbing"
        @pointerdown="onDragStart"
      >
        <GripVertical class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="flex-1 text-xs font-medium">Select Color</span>
        <button
          type="button"
          class="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Close color picker"
          @click="emit('close')"
        >
          <X class="size-3.5" />
        </button>
      </div>

      <div class="flex gap-1 p-2 pb-1.5">
        <button
          type="button"
          class="flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
          :class="target === 'sentence' ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground hover:text-foreground'"
          :aria-expanded="target === 'sentence' ? showPresetColors : undefined"
          @click="onTargetClick('sentence')"
        >
          Sentence
        </button>
        <button
          type="button"
          class="flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
          :class="target === 'word' ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground hover:text-foreground'"
          :aria-expanded="target === 'word' ? showPresetColors : undefined"
          @click="onTargetClick('word')"
        >
          Word
        </button>
      </div>

      <div v-show="showPresetColors" class="grid grid-cols-4 gap-1.5 px-2 pb-2">
        <button
          v-for="preset in PRESET_COLORS"
          :key="preset.hex"
          type="button"
          class="size-7 rounded-md border-2 transition-transform hover:scale-105"
          :class="currentColor.toLowerCase() === preset.hex ? 'border-foreground' : 'border-transparent'"
          :style="{ backgroundColor: preset.hex }"
          :title="preset.label"
          :aria-label="preset.label"
          @click="emitColor(preset.hex)"
        />
      </div>

      <div class="space-y-2 border-t border-border px-2 py-2">
        <div v-show="showCustomPicker" class="space-y-2">
          <div
            ref="slPickerRef"
            class="relative h-16 w-full cursor-crosshair touch-none overflow-hidden rounded-md border border-border"
            :style="{ background: slBackground }"
            aria-label="Saturation and lightness"
            @pointerdown="onSlPointerDown"
            @pointermove="onSlPointerMove"
            @pointerup="onSlPointerEnd"
            @pointercancel="onSlPointerEnd"
          >
            <span
              class="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm ring-1 ring-black/20"
              :style="{ left: `${hsl.s}%`, top: `${100 - hsl.l}%`, backgroundColor: currentColor }"
            />
          </div>

          <div
            ref="huePickerRef"
            class="relative h-2.5 w-full cursor-ew-resize touch-none overflow-hidden rounded-full border border-border"
            style="
              background: linear-gradient(
                to right,
                hsl(0 100% 50%),
                hsl(60 100% 50%),
                hsl(120 100% 50%),
                hsl(180 100% 50%),
                hsl(240 100% 50%),
                hsl(300 100% 50%),
                hsl(360 100% 50%)
              );
            "
            aria-label="Hue"
            @pointerdown="onHuePointerDown"
            @pointermove="onHuePointerMove"
            @pointerup="onHuePointerEnd"
            @pointercancel="onHuePointerEnd"
          >
            <span
              class="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm ring-1 ring-black/20"
              :style="{ left: `${(hsl.h / 360) * 100}%`, backgroundColor: `hsl(${hsl.h} 100% 50%)` }"
            />
          </div>
        </div>

        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="size-7 shrink-0 rounded-md border border-border transition-transform hover:scale-105"
            :class="showCustomPicker ? 'ring-2 ring-primary ring-offset-1 ring-offset-card' : ''"
            :style="{ backgroundColor: currentColor }"
            :aria-expanded="showCustomPicker"
            aria-label="Toggle custom color picker"
            @click="toggleCustomPicker"
          />
          <input
            class="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-[11px] uppercase text-foreground"
            type="text"
            maxlength="7"
            spellcheck="false"
            :value="hexInput"
            aria-label="Hex color"
            @input="onHexInput"
            @change="onHexCommit"
            @keydown.enter="onHexCommit"
          />
          <button
            type="button"
            class="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            :title="copyFromOtherLabel"
            :aria-label="copyFromOtherLabel"
            @click="copyFromOtherTarget"
          >
            <Pipette class="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
