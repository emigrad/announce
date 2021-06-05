import { Subscriber } from '../types'

/**
 * Returns true if the subscriber has a dead letter queue
 */
export function hasDeadLetterQueue(subscriber: Subscriber<any>): boolean {
  return subscriber.options?.deadLetterQueue !== false
}

/**
 * Returns the name of the subscriber's dead letter queue, or null if
 * it doesn't have one
 */
export function getDeadLetterQueue(subscriber: Subscriber<any>): string | null {
  return hasDeadLetterQueue(subscriber) ? `${subscriber.name}.dlq` : null
}
