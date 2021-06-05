import { LeveledLogMethod, Logger, Subscriber } from '../types'
import { errorLoggerMiddleware } from './errorLogger'
import { loggerMiddleware } from './logger'
import { applyMiddlewares } from './util'

describe('Middleware utilities', () => {
  it('Should return a subscriber that uses the middlewares', async () => {
    const error = new Error('no')
    const subscriber: Subscriber<any, any> = {
      name: 'test',
      topics: ['foo'],
      handle: jest.fn().mockRejectedValue(error)
    }
    const logger = {
      error: jest.fn() as LeveledLogMethod,
      debug: jest.fn() as LeveledLogMethod
    } as Logger
    const wrappedSubscriber = applyMiddlewares(
      loggerMiddleware(logger),
      errorLoggerMiddleware()
    )(subscriber)

    expect(wrappedSubscriber).toMatchObject({
      name: subscriber.name,
      topics: subscriber.topics
    })
    await expect(
      wrappedSubscriber.handle(undefined, {
        topic: 'test',
        headers: { id: 'abcd', published: new Date().toISOString() }
      })
    ).rejects.toBe(error)
    // This won't happen if the middlewares are applied in the wrong order
    expect(logger.error).toHaveBeenCalledWith('Error processing message', {
      error
    })
  })
})
