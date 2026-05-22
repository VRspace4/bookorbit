import { onMounted, onUnmounted, ref } from 'vue'
import { getReaderDeviceFormFactor, READER_MOBILE_MAX_WIDTH, READER_TABLET_MAX_WIDTH, type ReaderDeviceFormFactor } from '@bookorbit/types'

export { READER_MOBILE_MAX_WIDTH, READER_TABLET_MAX_WIDTH, getReaderDeviceFormFactor }

export function useReaderDeviceFormFactor() {
  const deviceFormFactor = ref<ReaderDeviceFormFactor>(getReaderDeviceFormFactor())

  let mobileQuery: MediaQueryList | null = null
  let tabletQuery: MediaQueryList | null = null

  function update() {
    deviceFormFactor.value = getReaderDeviceFormFactor()
  }

  onMounted(() => {
    mobileQuery = window.matchMedia(`(max-width: ${READER_MOBILE_MAX_WIDTH}px)`)
    tabletQuery = window.matchMedia(`(max-width: ${READER_TABLET_MAX_WIDTH}px)`)
    mobileQuery.addEventListener('change', update)
    tabletQuery.addEventListener('change', update)
  })

  onUnmounted(() => {
    mobileQuery?.removeEventListener('change', update)
    tabletQuery?.removeEventListener('change', update)
  })

  return { deviceFormFactor }
}
