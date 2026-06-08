// @vitest-environment jsdom
import type { TokenStyleMode } from 'stream-markdown'
import {
  createScheduledTokenIncrementalUpdater,
  createShikiStreamCachedRenderer,
  createShikiStreamRenderer,
  createTokenIncrementalUpdater,
  renderCodeWithTokens,
  scheduleRenderJob,
  updateCodeTokensIncremental,
} from 'stream-markdown'
import { describe, expect, it } from 'vitest'

describe('stream-markdown public API', () => {
  it('exports renderer helpers from the package entry', () => {
    const mode: TokenStyleMode = 'class'

    expect(mode).toBe('class')
    expect(typeof renderCodeWithTokens).toBe('function')
    expect(typeof updateCodeTokensIncremental).toBe('function')
    expect(typeof createTokenIncrementalUpdater).toBe('function')
    expect(typeof createScheduledTokenIncrementalUpdater).toBe('function')
    expect(typeof createShikiStreamRenderer).toBe('function')
    expect(typeof createShikiStreamCachedRenderer).toBe('function')
    expect(typeof scheduleRenderJob).toBe('function')
  })
})
