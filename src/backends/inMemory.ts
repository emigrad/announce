import PromiseQueue from 'promise-queue'
import { Backend, Message, Subscriber } from '../types'

interface SubscriberWithQueue extends Subscriber<any, any> {
  queue: PromiseQueue
}

/**
 * An in-memory backend. Not intended for production use because the broker is not
 * backed by any persistent storage - ie data loss can occur when the application
 * shuts down
 */
export class InMemory implements Backend {
  private readonly subscribers: SubscriberWithQueue[] = []

  /**
   * Publishes the message to all interested subscribers
   */
  publish(message: Message<any>) {
    this.getMatchingSubscribers(message.topic).forEach(({ queue, handle }) =>
      queue.add(async () => {
        try {
          await handle((message as Message<any>).body, { ...message })
        } catch (e) {
          // Squelch - use middleware to process errors
        }
      })
    )

    return Promise.resolve()
  }

  /**
   * Registers a subscriber
   */
  subscribe(subscriber: Subscriber<any, any>) {
    this.subscribers.push({
      ...subscriber,
      queue: new PromiseQueue(subscriber.options?.concurrency ?? 1)
    })
  }

  /**
   * Returns the subscribers that are interested in the message
   */
  private getMatchingSubscribers(topic: string): SubscriberWithQueue[] {
    return this.subscribers.filter(subscribesTo(topic))
  }
}

function subscribesTo(
  topic: string
): (subscriber: Subscriber<any, any>) => boolean {
  return (subscriber) =>
    subscriber.topics.some((topicSelector) =>
      getTopicSelectorRegExp(topicSelector).test(topic)
    )
}

function getTopicSelectorRegExp(topicSelector: string): RegExp {
  const regExpStr = topicSelector
    .replace(/\./g, '\\.')
    .replace(/\*\*?/g, (match) => (match === '**' ? '.*' : '[^.]+'))

  return new RegExp(`^${regExpStr}$`)
}
