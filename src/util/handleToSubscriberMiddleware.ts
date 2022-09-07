import { HandleMiddleware, HandlerArgs, SubscribeMiddleware } from '../types'

export function handleToSubscriberMiddleware(
  handleMiddleware: HandleMiddleware,
  handlerArgs: HandlerArgs
): SubscribeMiddleware {
  return async ({ subscriber, next }) => {
    const origHandle = subscriber.handle

    await next({
      ...subscriber,
      handle: async (message) => {
        await handleMiddleware({
          message,
          subscriber,
          next: (message) => origHandle.call(subscriber, message, handlerArgs)
        })
      }
    })
  }
}
