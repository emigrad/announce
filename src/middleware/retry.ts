import { Message, Middleware, Subscriber } from '../types'
import { DelayArgs, withDelay } from './delay'

const TOPIC_HEADER = 'x-retry-topic'
const DATE_HEADER = 'x-retry-date'
export const RETRIES_HEADER = 'x-retry-retries'

interface RetryArgs {
  /** How long to wait before the first retry, in milliseconds */
  initialDelay?: number
  /** How much to increase the delay by on each failed attempt */
  increaseFactor?: number
  /** How much to vary the delay by for each message */
  variation?: number
  /** The maximum number of times to attempt processing a message before failing */
  maxRetries?: number
  /**
   * A function to determine whether a message should be retried. If it returns
   * false, the message will be permanently rejected
   */
  canRetry?: (error: unknown, message: Message) => boolean
}

export const retry = ({
  initialDelay = 1000,
  increaseFactor = 10,
  variation = 0.1,
  maxRetries = 5,
  canRetry = () => true
}: RetryArgs = {}): Middleware => {
  return ({ announce, addSubscribeMiddleware }) => {
    const initializedQueues: string[] = []

    addSubscribeMiddleware(async ({ subscriber, next }) => {
      await createRetryQueues(subscriber, next)

      await next({
        ...subscriber,
        topics: [
          ...subscriber.topics,
          // This topic is added so that we can re-inject messages we want
          // to try into just this queue. We can't use the subscriber's
          // existing topics because there may be other subscribers listening
          // to them
          getRetryTopic(subscriber, 0)
        ],
        async handle(message, args) {
          // Since retried messages have a different topic, we have to
          // restore the message's original topic before sending it to
          // the subscriber
          if (message.headers[TOPIC_HEADER] != null) {
            message.topic = message.headers[TOPIC_HEADER]
          }

          try {
            await subscriber.handle(message, args)
          } catch (e) {
            if (canRetry(e, message) && getNumRetries(message) < maxRetries) {
              await retryMessage(subscriber, message)
            } else {
              throw e
            }
          }
        }
      })
    })

    /**
     * Creates the queues for the messages that need to be retried
     */
    async function createRetryQueues(
      subscriber: Subscriber,
      next: (subscriber: Subscriber) => Promise<unknown>
    ) {
      if (!initializedQueues.includes(subscriber.queueName)) {
        for (let retry = 1; retry <= maxRetries; retry++) {
          await createRetryQueue(subscriber, retry, next)
        }

        initializedQueues.push(subscriber.queueName)
      }
    }

    /**
     * Creates an individual retry queue
     */
    async function createRetryQueue(
      subscriber: Subscriber,
      retryNum: number,
      next: (subscriber: Subscriber) => Promise<unknown>
    ) {
      await next(
        withDelay(
          getRetrySubscriber(subscriber, retryNum),
          getDelayArgs(retryNum)
        )
      )
    }

    /**
     * Queues the message in the appropriate retry queue
     */
    async function retryMessage(subscriber: Subscriber, message: Message) {
      const nextRetry = getNumRetries(message) + 1

      // We need to override the topic to our retry queue, but we store
      // it in the header so we can restore it before passing it to the
      // original handler.
      // We need to override the date so that withDelay() delays from now,
      // not from when the message was first published.
      await announce.publish({
        ...message,
        headers: {
          ...message.headers,
          [TOPIC_HEADER]: getTopic(message),
          [RETRIES_HEADER]: String(nextRetry),
          [DATE_HEADER]: message.properties.date.toISOString()
        },
        topic: getRetryTopic(subscriber, nextRetry),
        properties: {
          ...message.properties,
          date: new Date()
        }
      })
    }

    /**
     * Returns a subscriber for retrying messages
     */
    function getRetrySubscriber(
      subscriber: Subscriber,
      retryNum: number
    ): Subscriber {
      const name = getRetryTopic(subscriber, retryNum)

      return {
        queueName: name,
        topics: [name],
        handle(message) {
          return announce.publish({
            ...message,
            topic: message.headers[TOPIC_HEADER],
            properties: {
              ...message.properties,
              // Restore the message's original date
              date: new Date(message.headers[DATE_HEADER])
            }
          })
        },
        options: {
          concurrency: 1,
          preserveRejectedMessages: false
        }
      }
    }

    /**
     * Returns the arguments to give to withDelay()
     */
    function getDelayArgs(retryNum: number): DelayArgs {
      return {
        delay: initialDelay * Math.pow(increaseFactor, retryNum - 1),
        variation
      }
    }
  }
}

/**
 * Returns the message's actual topic
 */
function getTopic(message: Message): string {
  return message.headers[TOPIC_HEADER] ?? message.topic
}

/**
 * Returns the topic to publish retry messages to
 */
function getRetryTopic(subscriber: Subscriber, retryNum: number) {
  return `~retry.${subscriber.queueName}.${retryNum}`
}

/**
 * Returns the number of retry attempts this message has had
 */
function getNumRetries(message: Message): number {
  return +(message.headers[RETRIES_HEADER] ?? '0')
}
