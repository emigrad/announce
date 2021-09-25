import { Message } from '../types'
import { LocalBackend } from './LocalBackend'

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
  static accepts(url: string) {
    return url.startsWith('memory://')
  }

  constructor() {
    super()
  }

  /**
   * Publishes the message to all interested subscribers
   */
  async publish(message: Message<Buffer>) {
    this.getMatchingSubscribers(message).forEach((subscriber) =>
      subscriber.queue.add(async () => {
        try {
          await subscriber.handle(message)
        } catch (e) {
          // Squelch - use middleware to process errors
        }
      })
    )

    return Promise.resolve()
  }
}
