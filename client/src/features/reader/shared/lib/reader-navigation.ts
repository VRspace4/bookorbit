import type { Router } from 'vue-router'

const READER_PATH_PREFIX = '/read'
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

export async function exitReader(router: Router): Promise<void> {
  const backPath = browserHistoryBackPath()
  if (canExitWithRouterBack(backPath)) {
    await router.back()
    return
  }

  await router.replace({ name: 'dashboard' })
}
