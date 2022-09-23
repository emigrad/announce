import { Middleware } from '../types'

export const MULTIPLE_SUBSCRIBERS_NOT_ALLOWED_MESSAGE =
  'Multiple subscriptions to the same queue are not allowed - ' +
  'please ensure the queue names of your subscribers are unique ' +
  '(they can bind to the same topics and will all receive ' +
  'the messages published to those topics).'

export function disallowMultipleQueueSubscriptions(): Middleware {
  const subscribedQueueNames = new Set<string>()

  return ({ addSubscribeMiddleware, addDestroyQueueMiddleware }) => {
    addSubscribeMiddleware(async ({ subscriber, next }) => {
      const queueName = subscriber.queueName

      if (!subscribedQueueNames.has(queueName)) {
        subscribedQueueNames.add(queueName)
        let successful = false

        try {
          await next(subscriber)
          successful = true
        } finally {
          if (!successful) {
            subscribedQueueNames.delete(queueName)
          }
        }
      } else {
        throw new Error(MULTIPLE_SUBSCRIBERS_NOT_ALLOWED_MESSAGE)
      }
    })

    addDestroyQueueMiddleware(async ({ queueName, next }) => {
      await next(queueName)
      subscribedQueueNames.delete(queueName)
    })
  }
}
