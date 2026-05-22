import type { CapacitorConfig } from '@capacitor/cli'

const androidServerUrl = process.env.BOOKORBIT_ANDROID_SERVER_URL?.trim().replace(/\/+$/, '')
const usesCleartextServer = androidServerUrl?.startsWith('http://') === true

const config: CapacitorConfig = {
  appId: 'app.bookorbit.mobile',
  appName: 'BookOrbit',
  webDir: 'dist',
  ...(androidServerUrl
    ? {
        server: {
          url: androidServerUrl,
          cleartext: usesCleartextServer,
        },
        android: {
          allowMixedContent: usesCleartextServer,
        },
      }
    : {}),
}

export default config
