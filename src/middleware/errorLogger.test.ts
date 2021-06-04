import {
  LeveledLogMethod,
  Logger,
  Message,
  NextFunction,
  Subscriber,
  SubscriberExtra
} from '../types'
import { errorLoggerMiddleware } from './errorLogger'

describe('Error logger', () => {
  it('Should log errors', async () => {
    const logger = {
      error: jest.fn() as LeveledLogMethod,
      debug: jest.fn() as LeveledLogMethod
    } as Logger
    const error = new Error('No')
    const subscriber: Subscriber<
      undefined,
      SubscriberExtra & { logger: Logger }
    > = {
      name: 'foo',
      topics: ['foo'],
      handle: () => {}
    }
    const next: NextFunction<any, any> = () => {
      throw error
    }
    const message: Message<undefined> = {
      topic: 'foo',
      headers: { id: '123', published: new Date() }
    }
    const middleware = errorLoggerMiddleware()

    await expect(
      middleware(subscriber)(
        undefined,
        { topic: message.topic, headers: message.headers, logger },
        next
      )
    ).rejects.toBe(error)

    expect(logger.error).toHaveBeenCalledWith('Error processing message', {
      error
    })
  })
})
