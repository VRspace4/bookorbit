<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle2, Download, Smartphone } from 'lucide-vue-next'
import { useInstallPrompt } from '@/features/pwa/composables/useInstallPrompt'

const installPrompt = useInstallPrompt()

const statusLabel = computed(() => {
  if (installPrompt.isInstalled.value) return 'Installed'
  if (installPrompt.isInstallable.value) return 'Ready to install'
  if (installPrompt.isIosInstallCandidate.value) return 'Available from Safari'
  return 'Available from the browser menu'
})

async function installApp() {
  await installPrompt.installApp()
}
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-4 md:p-5 space-y-4 shadow-xs">
    <div class="flex items-start justify-between gap-4">
      <div class="flex min-w-0 items-start gap-2">
        <Smartphone class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div class="min-w-0">
          <p class="text-sm font-semibold text-foreground">Native App</p>
          <p class="mt-0.5 text-xs text-muted-foreground">{{ statusLabel }}</p>
        </div>
      </div>
      <span
        v-if="installPrompt.isInstalled.value"
        class="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"
      >
        <CheckCircle2 :size="13" />
        Installed
      </span>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button v-if="installPrompt.isInstallable.value && !installPrompt.isInstalled.value" class="settings-btn-primary" @click="installApp">
        <Download :size="14" />
        Install BookOrbit
      </button>
      <p v-else-if="installPrompt.isIosInstallCandidate.value" class="text-xs text-muted-foreground">Use Share, then Add to Home Screen.</p>
      <p v-else-if="!installPrompt.isInstalled.value" class="text-xs text-muted-foreground">Use the browser install option when it appears.</p>
    </div>
  </section>
</template>
