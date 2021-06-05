import { Message } from '../types'
import { LocalBackend } from './local'

/**
 * An in-memory backend. Not intended for production use because the broker is not
 * backed by any persistent storage - ie data loss can occur when the application
 * shuts down
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
