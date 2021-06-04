import { Headers } from './message'

export interface Handler<
  Body extends {} | undefined,
  Extra extends { topic: string; headers: Headers }
> {
  (body: Body, extra: Extra): any | Promise<any>
}

export interface SubscriberOptions {
  /**
   * How many messages can be simultaneously processed by a subscriber. Defaults to 1
   */
  concurrency?: number
}

export interface SubscriberExtra {
  /** The topic of the message */
  topic: string
  /** The message headers */
  headers: Headers
}

export interface Subscriber<
  Body extends {} | undefined,
  Extra extends SubscriberExtra = SubscriberExtra
> {
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
  handle: Handler<Body, SubscriberExtra & Extra>

  /**
   * Any extra options
   */
  options?: SubscriberOptions
}
