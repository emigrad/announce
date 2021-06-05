import { Message } from './message'
import { Subscriber } from './subscriber'

export interface Backend {
  /**
   * Publishes a message to all interested subscribers
   */
  publish(message: Message<any>): Promise<void>

  /**
   * Adds the subscriber
   */
  subscribe(subscriber: Subscriber<any, any>): Promise<void>
}
