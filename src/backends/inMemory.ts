import { Message } from '../types'
import { LocalBackend } from './local'

/**
 * An in-memory backend for running tests etc. Not suitable for production
 * use as application shut downs can cause the loss of unprocessed messages
 *
 * Supports:
 *
 * Does not support:
 *  - guaranteed delivery
 *  - dead letter queues
 *  - inter-service messaging
 *  - multiple instances
 */
export class InMemoryBackend extends LocalBackend {
  /**
   * Publishes the message to all interested subscribers
   */
  publish(message: Message<any>) {
    this.getMatchingSubscribers(message).forEach((subscriber) =>
      subscriber.queue.add(async () => {
        try {
          await subscriber.handle((message as Message<any>).body, {
            ...message
          })
        } catch (e) {
          // Squelch - use middleware to process errors
        }
      })
    )

    return Promise.resolve()
  }
}
