import { Middleware, Subscriber } from '../types'

export interface SubscriptionFilterArgs {
  /**
   * Subscriptions whose queueName doesn't match the filter will be ignored
   */
  filter:
    | string
    | RegExp
    | ((subscriber: Subscriber) => boolean | Promise<boolean>)
}

/**
 * Only allow subscribers with matching queue names to subscribe. Use this
 * middleware to easily create instances of the application that only handle
 * certain queues (or no queues at all)
 */
export const subscriptionFilter: (
  args: SubscriptionFilterArgs
) => Middleware = (args) => {
  const filterFunc = getFilterFunc(args)

  return ({ addSubscribeMiddleware }) => {
    addSubscribeMiddleware(async ({ subscriber, next }) => {
      if (await filterFunc(subscriber)) {
        await next(subscriber)
      }
    })
  }
}

function getFilterFunc({
  filter
}: SubscriptionFilterArgs): (
  subscriber: Subscriber
) => boolean | Promise<boolean> {
  if (typeof filter === 'function') {
    return filter
  } else if (filter instanceof RegExp) {
    return ({ queueName }) => filter.test(queueName)
  } else {
    return ({ queueName }) => queueName === filter
  }
}
