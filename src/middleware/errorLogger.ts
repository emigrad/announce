import { Logger, Middleware, SubscriberExtra } from '../types'

export function errorLoggerMiddleware(): Middleware<
  SubscriberExtra & { logger: Logger }
> {
  return () => async (body, extra, next) => {
    try {
      await next(body, extra)
    } catch (error) {
      extra.logger.error('Error processing message', { error })
      extra.logger.debug('Full error details', {
        error,
        body,
        topic: extra.topic,
        headers: extra.headers
      })

      throw error
    }
  }
}
