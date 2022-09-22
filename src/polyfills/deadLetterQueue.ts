import {
  Backend,
  HandleMiddlewareArgs,
  Message,
  Middleware,
  SubscribeMiddlewareArgs,
  Subscriber
} from '../types'
import { getDeadLetterQueueName, getDeadLetterTopic } from '../util'

const ORIGINAL_TOPIC_HEADER = 'x-dlq-original-topic'

/**
 * Provides a dead letter queue capability for backends that don't have a
 * native one
 */
export function deadLetterQueue(backend: Backend): Middleware {
  return ({ addSubscribeMiddleware, addHandleMiddleware, publish }) => {
    addSubscribeMiddleware(subscribeMiddleware)
    addHandleMiddleware(handleMiddleware)

    async function subscribeMiddleware({
      subscriber,
      next
    }: SubscribeMiddlewareArgs): Promise<void> {
      const deadLetterQueueName = getDeadLetterQueueName(subscriber)
      const deadLetterTopic = getDeadLetterTopic(subscriber)

      if (deadLetterTopic && deadLetterQueueName) {
        await backend.bindQueue(deadLetterQueueName, [deadLetterTopic])
        await next({
          ...subscriber,
          options: { ...subscriber.options, preserveRejectedMessages: false }
        })
      } else {
        await next(subscriber)
      }
    }

    async function handleMiddleware({
      message,
      subscriber,
      next
    }: HandleMiddlewareArgs): Promise<void> {
      try {
        await next(restoreOriginalTopic(message))
      } catch {
        await handleRejectedMessage(message, subscriber)
      }
    }

    async function handleRejectedMessage(
      message: Message,
      subscriber: Subscriber
    ): Promise<void> {
      const deadLetterTopic = getDeadLetterTopic(subscriber)

      if (deadLetterTopic) {
        await publish({
          ...message,
          topic: deadLetterTopic,
          headers: {
            ...message.headers,
            [ORIGINAL_TOPIC_HEADER]: message.topic
          }
        })
      }
    }
  }
}

function restoreOriginalTopic(message: Message): Message {
  if (message.headers[ORIGINAL_TOPIC_HEADER]) {
    const newHeaders = { ...message.headers }
    delete newHeaders[ORIGINAL_TOPIC_HEADER]

    return {
      ...message,
      topic: message.headers[ORIGINAL_TOPIC_HEADER],
      headers: newHeaders
    }
  } else {
    return message
  }
}
