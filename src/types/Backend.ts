import * as Buffer from 'buffer'
import { EventEmitter } from 'events'
import { Message } from './Message'
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
   * Closes the connection
   */
  close(): Promise<void>
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
  handle: (message: Message<Buffer>) => void | Promise<void>

  /**
   * Any extra options
   */
  options?: SubscriberOptions
}
