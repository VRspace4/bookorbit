import { Capacitor, registerPlugin } from '@capacitor/core'

interface AnnaMirrorResolverPlugin {
  resolve(options: { url: string }): Promise<{ mirrors: string[] }>
}

const AnnaMirrorResolver = registerPlugin<AnnaMirrorResolverPlugin>('AnnaMirrorResolver')

export function isAnnaMirrorResolverAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function resolveAnnaMirrors(url: string): Promise<string[]> {
  const result = await AnnaMirrorResolver.resolve({ url })
  return result.mirrors.filter((mirror) => /^https?:\/\//i.test(mirror))
}
