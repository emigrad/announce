import * as Buffer from 'buffer'
import { EventEmitter } from 'events'
import { Message } from './Message'
import { Middleware } from './Middleware'
import { SubscriberOptions } from './Subscriber'

export interface Backend extends Pick<EventEmitter, 'on'> {
  /**
   * Publishes a message to all interested subscribers
   */
  publish(message: Message<Buffer>): Promise<void>

  /**
   * Adds the subscriber
   */
  subscribe(subscriber: BackendSubscriber): Promise<void>

  /**
   * Binds a queue to the given topics, causing that queue
   * to receive any messages sent to those topics
   */
  bindQueue: (queueName: string, topics: readonly string[]) => Promise<unknown>

  /**
   * Destroys the named queue, removing any unprocessed messages
   */
  destroyQueue: (queueName: string) => Promise<unknown>

  /**
   * Closes the connection
   */
  close(): Promise<void>

  /**
   * Returns the polyfill middlewares the backend needs to provide all
   * the expected capabilities
   */
  getPolyfills(): Middleware[]
}

export interface BackendConstructor {
  new (url: string): Backend

  /**
   * Returns true if the backend can handle the given URL
   */
  accepts(url: string): boolean
}

export interface BackendSubscriber {
  /** The name of the subscriber. Must be a globally unique dotted string */
  queueName: string

  /**
   * The topics to subscribe to.
   * * matches any value in that part of the topic
   * ** matches 0 or more parts of the topic.
   *
   * Eg:
   * user.* matches user.added, user.updated, but not user.abcd.added
   * **.added matches user.added, user.abcd.added and subscription.added
   */
  topics: string[]

  /**
   * The function to handle received messages
   */
  handle: (message: Message<Buffer>) => unknown | Promise<unknown>

  /**
   * Any extra options
   */
  options?: SubscriberOptions
}
