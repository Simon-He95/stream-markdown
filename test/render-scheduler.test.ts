// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearAll, drain, pause, resume, scheduleRenderJob } from '../packages/stream-markdown/src/utils/render-scheduler.js'

describe('render scheduler', () => {
  beforeEach(() => {
    clearAll()
    pause()
  })

  afterEach(() => {
    resume()
    clearAll()
  })

  it('cancels only its own queued job when the same function is scheduled more than once', () => {
    const order: string[] = []
    const sharedJob = () => order.push('shared')

    scheduleRenderJob(sharedJob)
    scheduleRenderJob(() => order.push('middle'))
    const cancelLastSharedJob = scheduleRenderJob(sharedJob)

    cancelLastSharedJob()
    drain()

    expect(order).toEqual(['shared', 'middle'])
  })
})
