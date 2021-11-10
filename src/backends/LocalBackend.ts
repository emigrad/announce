import { EventEmitter } from 'events'
import PromiseQueue from 'promise-queue'
import { groupBy } from 'rambda'
import { prop } from 'rambda/immutable'
import { Backend, BackendSubscriber, Message, Subscriber } from '../types'
import { getConcurrency } from '../util'

export interface SubscriberWithQueue extends BackendSubscriber {
  queue: PromiseQueue
}

export abstract class LocalBackend extends EventEmitter implements Backend {
  protected readonly subscribers: SubscriberWithQueue[] = []

  abstract publish(message: Message<Buffer>): Promise<void>

  /**
   * Registers a subscriber
   */
  async subscribe(subscriber: BackendSubscriber): Promise<void> {
    this.subscribers.push({
      ...subscriber,
      queue: new PromiseQueue(getConcurrency(subscriber))
    })
  }

  async close(): Promise<void> {}

  /**
   * Returns the subscribers that are interested in the message
   */
  protected getMatchingSubscribers({
    topic
  }: Message<Buffer>): SubscriberWithQueue[] {
    const matchingSubscribers = this.subscribers.filter(subscribesTo(topic))
    // Where there are multiple subscribers with the same name, only one
    // should receive each message
    const subscribersByName = groupBy(prop('queueName'), matchingSubscribers)

    return Object.values(subscribersByName).map(
      getSubscriberWithFewestUnprocessedMessages
    )
  }
}

function subscribesTo(
  topic: string
): (subscriber: Subscriber<Buffer>) => boolean {
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

function getSubscriberWithFewestUnprocessedMessages(
  subscribers: readonly SubscriberWithQueue[]
): SubscriberWithQueue {
  let bestSubscriber = subscribers[0]

  subscribers.forEach((subscriber) => {
    // By adding Math.random(), where multiple subscribers have the
    // same number of unprocessed messages, we will randomly distribute
    // the messages between them rather than always choosing the first
    if (
      subscriber.queue.getPendingLength() + Math.random() <
      bestSubscriber.queue.getPendingLength() + Math.random()
    ) {
      bestSubscriber = subscriber
    }
  })

  return bestSubscriber
}
