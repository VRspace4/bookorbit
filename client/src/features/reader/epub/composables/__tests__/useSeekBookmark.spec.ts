import { describe, expect, it } from 'vitest'
import { useSeekBookmark } from '../useSeekBookmark'

describe('useSeekBookmark', () => {
  it('places a bookmark at the current position when seeking elsewhere', () => {
    const current = { fraction: 0.49, cfi: 'epubcfi(/6/4!/4/2/1:0)' }
    const { seekBookmark, placeBookmarkBeforeSeek } = useSeekBookmark(() => current)

    placeBookmarkBeforeSeek(0.75)

    expect(seekBookmark.value).toEqual({ fraction: 0.49, cfi: 'epubcfi(/6/4!/4/2/1:0)' })
  })

  it('does not place a bookmark when the seek distance is negligible', () => {
    const current = { fraction: 0.5, cfi: null }
    const { seekBookmark, placeBookmarkBeforeSeek } = useSeekBookmark(() => current)

    placeBookmarkBeforeSeek(0.505)

    expect(seekBookmark.value).toBeNull()
  })

  it('does not replace the bookmark on a subsequent seek', () => {
    let current = { fraction: 0.2, cfi: 'cfi-a' }
    const { seekBookmark, placeBookmarkBeforeSeek } = useSeekBookmark(() => current)

    placeBookmarkBeforeSeek(0.5)
    current = { fraction: 0.5, cfi: 'cfi-b' }
    placeBookmarkBeforeSeek(0.8)

    expect(seekBookmark.value).toEqual({ fraction: 0.2, cfi: 'cfi-a' })
  })

  it('clears the bookmark explicitly', () => {
    const current = { fraction: 0.3, cfi: null }
    const { seekBookmark, placeBookmarkBeforeSeek, clearBookmark } = useSeekBookmark(() => current)

    placeBookmarkBeforeSeek(0.7)
    clearBookmark()

    expect(seekBookmark.value).toBeNull()
  })
})
