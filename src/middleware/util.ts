import { Middleware, Subscriber } from '../types'

/**
 * Returns a new subscriber that has the given middlewares applied to its handle function
 */
export function applyMiddlewares(
  ...middlewares: Middleware<any, any>[]
): (subscriber: Subscriber<any, any>) => Subscriber<any, any> {
  return (subscriber) => {
    const handle = middlewares.reduceRight((handle, middleware) => {
      return (message, extra) => middleware(subscriber)(message, extra, handle)
    }, subscriber.handle)

    return { ...subscriber, handle }
  }
}
