import { Logger, Middleware, SubscriberExtra } from '../types'

export function loggerMiddleware<T extends SubscriberExtra>(
  logger: Logger
): Middleware<SubscriberExtra, SubscriberExtra & { logger: Logger }> {
  return () => (body, extra, next) => next(body, { ...extra, logger })
}
