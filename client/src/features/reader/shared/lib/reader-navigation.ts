import type { Router } from 'vue-router'

const READER_PATH_PREFIX = '/read'
const READER_RETURN_KEY = 'reader:return-to'
const NON_APP_EXIT_PREFIXES = ['/login', '/setup', '/forgot-password', '/reset-password', '/oauth2-callback', '/magic']

function browserHistoryBackPath(): string | null {
  if (typeof window === 'undefined') return null
  const state = window.history.state as { back?: unknown } | null
  return typeof state?.back === 'string' ? state.back : null
}

export function isReaderPath(path: string | null | undefined): boolean {
  return typeof path === 'string' && (path === READER_PATH_PREFIX || path.startsWith(`${READER_PATH_PREFIX}/`))
}

function backPathname(backPath: string): string {
  return backPath.split(/[?#]/, 1)[0] ?? backPath
}

function canExitWithRouterBack(backPath: string | null): boolean {
  if (!backPath) return false
  const pathname = backPathname(backPath)
  return (
    pathname.startsWith('/') &&
    !pathname.startsWith('//') &&
    !isReaderPath(pathname) &&
    !NON_APP_EXIT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  )
}

function readRememberedReturnRoute(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const remembered = window.sessionStorage.getItem(READER_RETURN_KEY)
    return remembered && canExitWithRouterBack(remembered) ? remembered : null
  } catch {
    return null
  }
}

function rememberReaderReturnRoute(fullPath: string): void {
  if (typeof window === 'undefined' || !canExitWithRouterBack(fullPath)) return
  try {
    window.sessionStorage.setItem(READER_RETURN_KEY, fullPath)
  } catch {
    // sessionStorage may be unavailable in private modes.
  }
}

function clearRememberedReturnRoute(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(READER_RETURN_KEY)
  } catch {
    // Ignore storage failures during navigation.
  }
}

function preferredExitTarget(): string | null {
  return readRememberedReturnRoute() ?? browserHistoryBackPath()
}

export function registerReaderReturnRoute(router: Router): void {
  router.beforeEach((to, from) => {
    if (isReaderPath(to.path) && !isReaderPath(from.path)) {
      rememberReaderReturnRoute(from.fullPath)

      const backPath = browserHistoryBackPath()
      if (backPath && isReaderPath(backPathname(backPath)) && pathsMatch(backPath, to.fullPath)) {
        return { ...to, replace: true }
      }
    }

    // Android PWA can stack duplicate reader entries (e.g. launch restore + open book).
    // System back then pops between identical reader routes instead of exiting.
    if (isReaderPath(from.path) && isReaderPath(to.path) && pathsMatch(from.path, to.path)) {
      const exitTarget = readRememberedReturnRoute() ?? browserHistoryBackPath()
      if (exitTarget && canExitWithRouterBack(exitTarget) && !pathsMatch(exitTarget, from.fullPath)) {
        clearRememberedReturnRoute()
        return exitTarget
      }
    }

    return true
  })
}

function currentPath(router: Router): string {
  return router.currentRoute.value.path
}

function currentFullPath(router: Router): string {
  return router.currentRoute.value.fullPath
}

function pathsMatch(left: string, right: string): boolean {
  return left === right || left.split(/[?#]/, 1)[0] === right.split(/[?#]/, 1)[0]
}

export async function exitReader(router: Router): Promise<void> {
  if (!isReaderPath(currentPath(router))) {
    return
  }

  const remembered = readRememberedReturnRoute()
  const exitTarget = preferredExitTarget()

  if (remembered && canExitWithRouterBack(remembered)) {
    await router.replace(remembered)
    clearRememberedReturnRoute()
    return
  }

  if (canExitWithRouterBack(exitTarget) && exitTarget) {
    const maxSteps = maxHistoryBackSteps()
    for (let step = 0; step < maxSteps; step++) {
      await router.back()
      await router.isReady()
      if (isReaderPath(currentPath(router))) {
        continue
      }
      if (pathsMatch(currentFullPath(router), exitTarget)) {
        clearRememberedReturnRoute()
        return
      }
      await router.replace(exitTarget)
      clearRememberedReturnRoute()
      return
    }

    await router.replace(exitTarget)
    clearRememberedReturnRoute()
    return
  }

  clearRememberedReturnRoute()
  await router.replace({ name: 'dashboard' })
}

let readerExitInProgress = false

export async function leaveReader(
  router: Router,
  options: {
    flush?: () => void | Promise<void>
    onLeaving?: () => void
  } = {},
): Promise<void> {
  if (readerExitInProgress) return
  readerExitInProgress = true
  try {
    options.onLeaving?.()
    try {
      await options.flush?.()
    } catch {
      // Still leave when progress could not be saved.
    }
    await exitReader(router)
  } finally {
    readerExitInProgress = false
  }
}

function maxHistoryBackSteps(): number {
  if (typeof window === 'undefined') return 1
  return Math.min(Math.max(window.history.length - 1, 0), 10)
}
