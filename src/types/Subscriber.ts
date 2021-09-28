import { Handler } from './Handler'

export interface SubscriberOptions {
  /**
   * How many messages can be simultaneously processed by a subscriber. Defaults to 1
   */
  concurrency?: number
  /**
   * Whether to save rejected messages in a dead letter queue. Not all backends
   * support dead letter queues (eg InMemoryBackend doesn't). Defaults to true for
   * supporting backends.
   */
  deadLetterQueue?: boolean
}

export interface Subscriber<Body extends any> {
  /** The name of the subscriber. Must be a globally unique dotted string */
  name: string

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
  handle: Handler<Body>

  /**
   * Any extra options
   */
  options?: SubscriberOptions
}
