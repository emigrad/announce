import { Announce } from '../Announce'
import { InMemoryBackend } from '../backends'
import { Subscriber } from '../types'
import { getCompleteMessage } from '../util'
import { json } from './json'
import { log, LogFunction } from './log'

describe('Logger middleware', () => {
  let logger: Logger
  let announce: Announce
  let backend: InMemoryBackend

  beforeEach(() => {
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn()
    } as Logger
    backend = new InMemoryBackend()
    announce = new Announce({ backendFactory: () => backend })
    announce.use(json(), log({ logger, logLevels: { handleSuccess: 'info' } }))
  })

  it.each([
    [false, 'error'],
    [true, 'debug']
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

      await expect(announce.publish(message)).rejects.toBe(error)
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
      handle: () => {
        // Do nothing
      }
    } as Subscriber

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
    } as Subscriber
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

interface Logger {
  info: LogFunction
  error: LogFunction
}
