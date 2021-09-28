import { Announce } from '../Announce'
import { Logger, Message, MiddlewareInstance, Subscriber } from '../types'
import { log } from './log'

describe('Logger middleware', () => {
  let logger: Logger
  const announce = {} as Announce
  let loggerMiddleware: MiddlewareInstance

  beforeEach(() => {
    logger = {
      trace: jest.fn(),
      info: jest.fn(),
      error: jest.fn()
    }
    loggerMiddleware = log(logger)(announce)
  })

  it.each([
    [false, 'error'],
    [true, 'trace']
  ])('Should log publishes (success: %p)', async (succeeded, level) => {
    const message = { topic: 'abc', headers: { id: '33' } } as Message<any>
    let next

    if (succeeded) {
      next = jest.fn().mockResolvedValue(null)
      await loggerMiddleware.publish!({ message, next })
    } else {
      const error = new Error()
      next = jest.fn().mockRejectedValue(error)
      await expect(loggerMiddleware.publish!({ message, next })).rejects.toBe(
        error
      )
    }

    expect(next).toHaveBeenCalledWith(message)
    expect(logger[level as keyof Logger]).toHaveBeenCalled()
  })

  it.each([
    [false, 'error'],
    [true, 'info']
  ])('Should log subscriptions (success: %p)', async (succeeded, level) => {
    const subscriber = { name: 'abc' } as Subscriber<any>
    let next

    if (succeeded) {
      next = jest.fn().mockResolvedValue(null)
      await loggerMiddleware.subscribe!({ subscriber, next })
    } else {
      const error = new Error()
      next = jest.fn().mockRejectedValue(error)
      await expect(
        loggerMiddleware.subscribe!({ subscriber, next })
      ).rejects.toBe(error)
    }

    expect(next).toHaveBeenCalledWith(subscriber)
    expect(logger[level as keyof Logger]).toHaveBeenCalled()
  })

  it.each([
    [false, 'error'],
    [true, 'trace']
  ])('Should log messages (success: %p)', async (succeeded, level) => {
    const subscriber = { name: 'abc' } as Subscriber<any>
    const message = { topic: 'abc', headers: { id: '33' } } as Message<any>
    let next

    if (succeeded) {
      next = jest.fn().mockResolvedValue(null)
      await loggerMiddleware.handle!({ next, subscriber, message })
    } else {
      const error = new Error()
      next = jest.fn().mockRejectedValue(error)
      await expect(
        loggerMiddleware.handle!({ message, next, subscriber })
      ).rejects.toBe(error)
    }

    expect(next).toHaveBeenCalledWith(message)
    expect(logger[level as keyof Logger]).toHaveBeenCalled()
  })
})
