import { Announce } from '../Announce'
import { InMemoryBackend } from '../backends'
import { Logger, Subscriber } from '../types'
import { getCompleteMessage } from '../util'
import { json } from './json'
import { log } from './log'

describe('Logger middleware', () => {
  let logger: Logger
  let announce: Announce
  let backend: InMemoryBackend

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      error: jest.fn()
    }
    backend = new InMemoryBackend()
    announce = new Announce({ backendFactory: { getBackend: () => backend } })
    announce.use(json(), log(logger))
  })

  it.each([
    [false, 'error'],
    [true, 'info']
  ])('Should log publishes (success: %p)', async (succeeded, level) => {
    const message = getCompleteMessage({
      topic: 'abc',
      body: null,
      headers: { id: '33' }
    })

    if (succeeded) {
      await announce.publish(message)
    } else {
      const error = new Error()
      backend.publish = jest.fn().mockRejectedValue(error)

      await expect(announce.publish!(message)).rejects.toBe(error)
    }

    expect(logger[level as keyof Logger]).toHaveBeenCalled()
  })

  it.each([
    [false, 'error'],
    [true, 'info']
  ])('Should log subscriptions (success: %p)', async (succeeded, level) => {
    const subscriber = {
      queueName: 'abc',
      topics: ['abc'],
      handle: () => {}
    } as Subscriber<any>

    if (succeeded) {
      await announce.subscribe(subscriber)
    } else {
      const error = new Error()
      backend.subscribe = jest.fn().mockRejectedValue(error)
      await expect(announce.subscribe(subscriber)).rejects.toBe(error)
    }

    expect(logger[level as keyof Logger]).toHaveBeenCalled()
  })

  it.each([
    [false, 'error'],
    [true, 'info']
  ])('Should log messages (success: %p)', async (succeeded, level) => {
    const error = new Error()
    const subscriber = {
      queueName: 'abc',
      topics: ['abc'],
      handle: () => {
        if (!succeeded) {
          throw error
        }
      }
    } as Subscriber<any>
    const message = getCompleteMessage({
      topic: 'abc',
      body: null,
      properties: { id: '33' }
    })

    await announce.subscribe(subscriber)
    await announce.publish(message)

    expect(logger[level as keyof Logger]).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('message for abc')
      })
    )
  })
})
