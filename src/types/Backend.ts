import * as Buffer from 'buffer'
import { EventEmitter } from 'events'
import { Message } from './Message'
import { Subscriber } from './Subscriber'

export interface Backend extends Pick<EventEmitter, 'on'> {
  /**
   * Publishes a message to all interested subscribers
   */
  publish(message: Message<Buffer>): Promise<void>

  /**
   * Adds the subscriber
   */
  subscribe(subscriber: Subscriber<Buffer>): Promise<void>

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
