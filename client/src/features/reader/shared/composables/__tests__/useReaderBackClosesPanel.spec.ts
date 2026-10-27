import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import { closeReaderPanelOnBack } from '../../lib/reader-navigation'
import { useReaderBackClosesPanel } from '../useReaderBackClosesPanel'

const leaveGuards = vi.hoisted(() => [] as Array<() => unknown>)

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (guard: () => unknown) => leaveGuards.push(guard),
}))

describe('useReaderBackClosesPanel', () => {
  let scope: EffectScope

  function mount(closeOpenPanel: () => boolean) {
    scope = effectScope()
    scope.run(() => useReaderBackClosesPanel(closeOpenPanel))
    return leaveGuards.at(-1)!
  }

  beforeEach(() => {
    leaveGuards.length = 0
  })

  afterEach(() => {
    scope.stop()
  })

  it('closes the open panel and stays in the book when the back gesture fires', () => {
    const closeOpenPanel = vi.fn<() => boolean>(() => true)
    const leaveGuard = mount(closeOpenPanel)

    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(leaveGuard()).toBe(false)
    expect(closeOpenPanel).toHaveBeenCalledTimes(1)
  })

  it('leaves the book on back when no panel is open', () => {
    const leaveGuard = mount(() => false)

    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(leaveGuard()).not.toBe(false)
  })

  it('lets in-app navigation leave with a panel open', () => {
    const closeOpenPanel = vi.fn<() => boolean>(() => true)
    const leaveGuard = mount(closeOpenPanel)

    expect(leaveGuard()).not.toBe(false)
    expect(closeOpenPanel).not.toHaveBeenCalled()
  })

  it('serves the Android back button until the reader closes', () => {
    mount(() => true)

    expect(closeReaderPanelOnBack()).toBe(true)
    scope.stop()
    expect(closeReaderPanelOnBack()).toBe(false)
  })
})
