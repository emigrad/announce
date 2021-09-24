import { EventEmitter } from 'events'
import { Message } from './message'
import { Subscriber } from './subscriber'

export interface Backend extends Pick<EventEmitter, 'on'> {
  /**
   * Publishes a message to all interested subscribers
   */
  publish(message: Message<any>): Promise<void>

  /**
   * Adds the subscriber
   */
  subscribe(subscriber: Subscriber<any, any>): Promise<void>
}

export interface BackendConstructor {
  new (url: string): Backend

  /**
   * Returns true if the backend can handle the given URL
   */
  accepts(url: string): boolean
}
