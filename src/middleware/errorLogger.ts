import { Logger, Middleware, SubscriberExtra } from '../types'

export function errorLoggerMiddleware(): Middleware<
  SubscriberExtra & { logger: Logger }
> {
  return () => (body, extra, next) => {
    const promise = toPromise()
    promise.catch((error: any) => {
      extra.logger.error('Error processing message', { error })
      extra.logger.debug('Full error details', {
        error,
        body,
        topic: extra.topic,
        headers: extra.headers
      })
    })

    return promise

    /** Ensures we have a promise, regardless of whether next() returns one or not */
    async function toPromise() {
      return next(body, extra)
    }
  }
}
