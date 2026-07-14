export const SYSTEM_TABS = ['file-naming', 'book-dock', 'maintenance', 'text-to-speech', 'audit-log'] as const

export type SystemTab = (typeof SYSTEM_TABS)[number]

type SystemTabInfo = {
  permission: string | null
}

export const SYSTEM_TAB_INFO: Record<SystemTab, SystemTabInfo> = {
  'file-naming': {
    permission: 'manage_app_settings',
  },
  'book-dock': {
    permission: 'book_dock_access',
  },
  maintenance: {
    permission: 'manage_app_settings',
  },
  'text-to-speech': {
    navLabel: 'Text-to-Speech',
    titleLabel: 'Text-to-Speech',
    subtitle: 'Configure cloud TTS provider API keys for all users and devices.',
    permission: 'manage_app_settings',
  },
  'audit-log': {
    permission: null,
  },
}

export function normalizeSystemTab(value: unknown): SystemTab {
  if (typeof value === 'string' && SYSTEM_TABS.includes(value as SystemTab)) {
    return value as SystemTab
  }
  return 'file-naming'
}
