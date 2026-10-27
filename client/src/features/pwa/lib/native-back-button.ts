import type { Router } from 'vue-router'
import { closeReaderPanelOnBack, exitReader, isReaderPath } from '@/features/reader/shared/lib/reader-navigation'
import { isCapacitorNative } from './native-app'

export function registerNativeBackButton(router: Router): void {
  if (!isCapacitorNative()) return

  void import('@capacitor/app')
    .then(({ App }) =>
      App.addListener('backButton', () => {
        if (isReaderPath(router.currentRoute.value.path)) {
          if (closeReaderPanelOnBack()) return
          void exitReader(router)
          return
        }

        if (window.history.length > 1) {
          void router.back()
          return
        }

        void App.minimizeApp()
      }),
    )
    .catch(() => {
      // App plugin unavailable outside native Capacitor builds.
    })
}
