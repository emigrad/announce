import { Middleware, SubscriberWrapper } from '../types'

/**
 * Takes a function that wraps subscribers and returns middleware that
 * does the same thing
 */
export function createMiddleware<WrapperArgs extends unknown[], Body = unknown>(
  wrapper: SubscriberWrapper<WrapperArgs, Body>
): (...wrapperArgs: WrapperArgs) => Middleware {
  return (...wrapperArgs: WrapperArgs) => {
    return ({ addSubscribeMiddleware }) => {
      addSubscribeMiddleware(async ({ subscriber, next }) => {
        return next(wrapper(subscriber, ...wrapperArgs))
      })
    }
  }
}
