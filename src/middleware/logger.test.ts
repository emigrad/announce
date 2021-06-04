import {
  LeveledLogMethod,
  Logger,
  Message,
  NextFunction,
  Subscriber
} from '../types'
import { loggerMiddleware } from './logger'

describe('Logger middleware', () => {
  it('Should add its logger instance', () => {
    const logger = { info: jest.fn() as LeveledLogMethod } as Logger
    const subscriber: Subscriber<undefined, { logger: Logger }> = {
      name: 'foo',
      topics: ['foo'],
      handle: jest.fn()
    }
    const next: NextFunction<any, any> = (body, { topic, headers, logger }) => {
      logger.info({ body, topic, headers })
    }
    const message: Message<undefined> = {
      topic: 'foo',
      headers: { id: '123', published: new Date() }
    }
    const middleware = loggerMiddleware(logger)
    middleware(subscriber)(
      undefined,
      { topic: message.topic, headers: message.headers },
      next
    )

    expect(logger.info).toHaveBeenCalledWith({ ...message, body: undefined })
  })
})
