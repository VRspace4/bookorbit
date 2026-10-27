import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { closeReaderPanelOnBack } from '../../lib/reader-navigation'
import { useReaderBackClosesPanel } from '../useReaderBackClosesPanel'

const leaveGuards = vi.hoisted(() => [] as Array<() => unknown>)

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (guard: () => unknown) => leaveGuards.push(guard),
}))

describe('useReaderBackClosesPanel', () => {
  let scope: EffectScope
  let pops: Array<() => void>
  // Stands in for the router: it must only ever see real navigation.
  const routerPop = vi.fn<() => void>()
  const watchPops = () => pops.shift()?.()

  function nextPop() {
    return new Promise<void>((resolve) => pops.push(resolve))
  }

  async function settle() {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  async function back() {
    const popped = nextPop()
    history.back()
    await popped
    await settle()
  }

  function mount(panels = ref(0)) {
    const closeOpenPanel = vi.fn<() => boolean>(() => {
      if (panels.value === 0) return false
      panels.value--
      return true
    })
    scope = effectScope()
    scope.run(() => useReaderBackClosesPanel(() => panels.value > 0, closeOpenPanel))
    return { panels, closeOpenPanel, leaveGuard: leaveGuards.at(-1)! }
  }

  beforeEach(() => {
    pops = []
    leaveGuards.length = 0
    routerPop.mockClear()
    history.replaceState({ position: 1 }, '', '/read/1/2')
    window.addEventListener('popstate', watchPops, { capture: true })
    window.addEventListener('popstate', routerPop)
  })

  afterEach(() => {
    scope.stop()
    window.removeEventListener('popstate', watchPops, { capture: true })
    window.removeEventListener('popstate', routerPop)
  })

  it('opens a history entry with the panel, and Back closes only the panel', async () => {
    history.pushState({ position: 0 }, '', '/library')
    history.pushState({ position: 1 }, '', '/read/1/2')
    const { panels, closeOpenPanel } = mount()
    const lengthBefore = history.length

    panels.value = 1
    await settle()
    expect(history.length).toBe(lengthBefore + 1)
    expect(location.pathname).toBe('/read/1/2')

    await back()
    expect(closeOpenPanel).toHaveBeenCalledTimes(1)
    expect(panels.value).toBe(0)
    expect(location.pathname).toBe('/read/1/2')
    expect(routerPop).not.toHaveBeenCalled()

    await back()
    expect(location.pathname).toBe('/library')
    expect(routerPop).toHaveBeenCalledTimes(1)
  })

  it('removes the entry when the panel closes from its own controls', async () => {
    const { panels } = mount()
    panels.value = 1
    await settle()

    const popped = nextPop()
    panels.value = 0
    await popped
    await settle()

    expect(history.state).toEqual({ position: 1 })
    expect(routerPop).not.toHaveBeenCalled()
  })

  it('steps off the panel entry when Forward lands on it after Back closed the panel', async () => {
    const { panels } = mount()
    panels.value = 1
    await settle()
    await back()

    const landed = nextPop()
    const steppedOff = nextPop()
    history.forward()
    await landed
    await steppedOff
    await settle()

    expect(panels.value).toBe(0)
    expect(history.state).toEqual({ position: 1 })
    expect(routerPop).not.toHaveBeenCalled()
  })

  it('closes stacked panels one per Back', async () => {
    const { panels, closeOpenPanel } = mount()
    panels.value = 2
    await settle()

    await back()
    expect(panels.value).toBe(1)
    await back()
    expect(panels.value).toBe(0)
    expect(closeOpenPanel).toHaveBeenCalledTimes(2)
    expect(routerPop).not.toHaveBeenCalled()
  })

  it('releases the entry before the router leaves the book', async () => {
    const { panels, leaveGuard } = mount()
    panels.value = 1
    await settle()

    await leaveGuard()

    expect(history.state).toEqual({ position: 1 })
    expect(routerPop).not.toHaveBeenCalled()
  })

  it('lets the Android back button close the panel, then drops the entry', async () => {
    const { panels } = mount()
    panels.value = 1
    await settle()

    const popped = nextPop()
    expect(closeReaderPanelOnBack()).toBe(true)
    await popped
    await settle()

    expect(panels.value).toBe(0)
    expect(history.state).toEqual({ position: 1 })
    expect(routerPop).not.toHaveBeenCalled()
  })

  it('stops handling Back once the reader closes', () => {
    mount(ref(1))

    scope.stop()

    expect(closeReaderPanelOnBack()).toBe(false)
  })
})
