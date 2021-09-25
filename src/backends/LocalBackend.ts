import { EventEmitter } from 'events'
import PromiseQueue from 'promise-queue'
import { getConcurrency } from '../selectors'
import { Backend, Message, Subscriber } from '../types'

export interface SubscriberWithQueue extends Subscriber<any> {
  queue: PromiseQueue
}

export abstract class LocalBackend extends EventEmitter implements Backend {
  protected readonly subscribers: SubscriberWithQueue[] = []

  abstract publish(message: Message<any>): Promise<void>

  /**
   * Registers a subscriber
   */
  async subscribe(subscriber: Subscriber<any>): Promise<void> {
    this.subscribers.push({
      ...subscriber,
      queue: new PromiseQueue(getConcurrency(subscriber))
    })
  }

  /**
   * Returns the subscribers that are interested in the message
   */
  protected getMatchingSubscribers({
    topic
  }: Message<any>): SubscriberWithQueue[] {
    return this.subscribers.filter(subscribesTo(topic))
  }
}

function subscribesTo(topic: string): (subscriber: Subscriber<any>) => boolean {
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
