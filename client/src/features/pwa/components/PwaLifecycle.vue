<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Download, RefreshCcw, Smartphone, X } from 'lucide-vue-next'
import { useInstallPrompt } from '../composables/useInstallPrompt'
import { usePwaServiceWorker } from '../composables/usePwaServiceWorker'

const installPrompt = useInstallPrompt()
const serviceWorker = usePwaServiceWorker()

const showInstall = computed(() => installPrompt.canShowInstallPrompt.value && !installPrompt.isInstalled.value)
const showServiceWorkerPrompt = computed(() => serviceWorker.needRefresh.value || serviceWorker.restartReady.value)

onMounted(() => {
  void serviceWorker.register()
})

async function installApp() {
  await installPrompt.installApp()
  if (installPrompt.isInstallable.value) {
    installPrompt.dismissInstallPrompt()
  }
}
</script>

<template>
  <div
    v-if="showInstall || showServiceWorkerPrompt"
    class="fixed bottom-3 left-3 right-3 z-[90] flex flex-col items-stretch gap-2 pointer-events-none sm:left-auto sm:right-4 sm:w-[22rem]"
  >
    <section
      v-if="showInstall"
      class="pointer-events-auto rounded-lg border border-border bg-card/95 p-3 text-card-foreground shadow-lg backdrop-blur"
    >
      <div class="flex items-start gap-3">
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Smartphone :size="18" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold leading-5">Install BookOrbit</p>
          <p class="mt-0.5 text-xs leading-4 text-muted-foreground">{{ installPrompt.installHint.value }}</p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button v-if="installPrompt.isInstallable.value" class="settings-btn-primary h-8 px-3 text-xs" @click="installApp">
              <Download :size="13" />
              Install
            </button>
            <button class="settings-btn-outline h-8 px-3 text-xs" @click="installPrompt.dismissInstallPrompt()">Later</button>
          </div>
        </div>
        <button
          class="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Dismiss install prompt"
          @click="installPrompt.dismissInstallPrompt()"
        >
          <X :size="15" />
        </button>
      </div>
    </section>

    <section
      v-if="serviceWorker.needRefresh.value || serviceWorker.restartReady.value"
      class="pointer-events-auto rounded-lg border border-border bg-card/95 p-3 text-card-foreground shadow-lg backdrop-blur"
    >
      <div class="flex items-start gap-3">
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <RefreshCcw :size="18" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold leading-5">{{ serviceWorker.restartReady.value ? 'Update ready' : 'Update available' }}</p>
          <p class="mt-0.5 text-xs leading-4 text-muted-foreground">
            {{ serviceWorker.restartReady.value ? 'Restart when you are ready.' : 'Keep reading now or apply it for the next restart.' }}
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button v-if="serviceWorker.needRefresh.value" class="settings-btn-primary h-8 px-3 text-xs" @click="serviceWorker.activateUpdate()">
              Apply
            </button>
            <button v-if="serviceWorker.restartReady.value" class="settings-btn-primary h-8 px-3 text-xs" @click="serviceWorker.restartNow()">
              Restart
            </button>
            <button v-if="serviceWorker.needRefresh.value" class="settings-btn-outline h-8 px-3 text-xs" @click="serviceWorker.dismissUpdate()">
              Later
            </button>
          </div>
        </div>
        <button
          v-if="serviceWorker.needRefresh.value"
          class="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Dismiss update prompt"
          @click="serviceWorker.dismissUpdate()"
        >
          <X :size="15" />
        </button>
      </div>
    </section>
  </div>
</template>
