<script setup lang="ts">
defineProps<{
  savedSectionLabel: string
  currentSectionLabel: string
}>()

const emit = defineEmits<{
  continueSaved: []
  startHere: []
  cancel: []
}>()
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
          <p class="text-xs text-muted-foreground mt-2 leading-relaxed">
            Your last read-aloud position is in
            <span class="font-medium text-foreground">{{ savedSectionLabel }}</span
            >. You're currently reading <span class="font-medium text-foreground">{{ currentSectionLabel }}</span
            >.
          </p>
        </div>
        <div class="flex flex-col gap-2">
          <button
            type="button"
            class="w-full px-3 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-left"
            @click="emit('continueSaved')"
          >
            Continue from {{ savedSectionLabel }}
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
