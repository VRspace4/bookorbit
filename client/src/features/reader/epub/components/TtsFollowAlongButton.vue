<script setup lang="ts">
import { Crosshair } from 'lucide-vue-next'

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  resume: []
}>()
</script>

<template>
  <Transition name="tts-follow-fade">
    <button v-if="visible" type="button" class="tts-follow-along-btn" aria-label="Follow along with reading" @click="emit('resume')">
      <Crosshair :size="18" class="shrink-0" />
      <span class="text-xs font-semibold leading-none">Follow</span>
    </button>
  </Transition>
</template>
