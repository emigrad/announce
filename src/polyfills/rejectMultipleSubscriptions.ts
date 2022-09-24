import { Backend, Middleware } from '../types'

const MULTIPLE_SUBSCRIBERS_NOT_ALLOWED_MESSAGE =
  'Multiple subscriptions to the same queue are not allowed - ' +
  'please ensure the queue names of your subscribers are unique ' +
  '(they can bind to the same topics and will all receive ' +
  'the messages published to those topics).'

export function rejectMultipleSubscriptions(
  backend: Required<Pick<Backend, 'isSubscribed'>>
): Middleware {
  const lockedQueueNames = new Set<string>()

  return ({ addSubscribeMiddleware, addDestroyQueueMiddleware }) => {
    addSubscribeMiddleware(async ({ subscriber, next }) => {
      const queueName = subscriber.queueName
      const error = new Error(MULTIPLE_SUBSCRIBERS_NOT_ALLOWED_MESSAGE)

      if (lockedQueueNames.has(queueName)) {
        throw error
      }

      try {
        lockedQueueNames.add(queueName)
        if (await backend.isSubscribed(queueName)) {
          throw error
        } else {
          await next(subscriber)
        }
      } finally {
        lockedQueueNames.delete(queueName)
      }
    })

    addDestroyQueueMiddleware(async ({ queueName, next }) => {
      await next(queueName)
      lockedQueueNames.delete(queueName)
    })
  }
}
