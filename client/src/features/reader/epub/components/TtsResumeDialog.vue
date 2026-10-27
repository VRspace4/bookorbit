<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  savedSectionLabel: string
  currentSectionLabel: string
  /** True when last TTS position is in the same section but a different page/viewport. */
  sameViewSection?: boolean
}>()

const emit = defineEmits<{
  continueSaved: []
  startHere: []
  cancel: []
}>()

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('cancel')
  }
}

onMounted(() => document.addEventListener('keydown', onKeyDown, true))
onUnmounted(() => document.removeEventListener('keydown', onKeyDown, true))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" @click.self="emit('cancel')">
      <div
        class="bg-card text-card-foreground rounded-lg shadow-2xl p-4 w-full max-w-sm flex flex-col gap-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tts-resume-title"
      >
        <div>
          <p id="tts-resume-title" class="text-sm font-medium">Resume read aloud?</p>
          <p v-if="props.sameViewSection" class="text-xs text-muted-foreground mt-2 leading-relaxed">
            Your last read-aloud position isn't on the page you're viewing. Continue from where you left off, or read
            from this page (then tap a sentence to begin).
          </p>
          <p v-else class="text-xs text-muted-foreground mt-2 leading-relaxed">
            Your last read-aloud position is in
            <span class="font-medium text-foreground">{{ savedSectionLabel }}</span
            >. You're currently reading <span class="font-medium text-foreground">{{ currentSectionLabel }}</span
            >. Choose continue, or read from this page and tap a sentence to begin.
          </p>
        </div>
        <div class="flex flex-col gap-2">
          <button
            type="button"
            class="w-full px-3 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-left"
            @click="emit('continueSaved')"
          >
            {{ props.sameViewSection ? 'Continue from last position' : `Continue from ${savedSectionLabel}` }}
          </button>
          <button
            type="button"
            class="w-full px-3 py-2 rounded-lg text-sm border border-border hover:bg-muted transition-colors text-left"
            @click="emit('startHere')"
          >
            Read from here instead
          </button>
          <button
            type="button"
            class="w-full px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
            @click="emit('cancel')"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
