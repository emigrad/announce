import cuid from 'cuid'
import {
  Message,
  MessageProperties,
  UnpublishedMessage,
  Subscriber
} from '../types'

/**
 * Creates a new message for publication. Some message details such as
 * the ID and publication date will be generated when the message is published.
 */
export function createMessage<Body extends any>(
  topic: string,
  body: Body,
  headers: Record<string, string> = {},
  properties: Partial<MessageProperties> = {}
): UnpublishedMessage<Body> {
  return { topic, body, headers, properties }
}

/**
 * Returns a complete message with a unique ID and publication date.
 */
export function getCompleteMessage<Body extends any>(
  message: UnpublishedMessage<Body>
): Message<Body> {
  return {
    ...message,
    headers: message.headers ?? {},
    properties: getCompleteProperties(message.properties)
  }
}

/**
 * Fills out the incomplete properties
 */
export function getCompleteProperties(
  properties?: Partial<MessageProperties>
): MessageProperties {
  return {
    id: cuid(),
    date: new Date(),
    ...properties
  }
}

/**
 * Returns how many messages the subscriber is allowed to simultaneously
 * process
 */
export function getConcurrency(subscriber: Subscriber<any>): number {
  return subscriber.options?.concurrency ?? 1
}

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
  return hasDeadLetterQueue(subscriber) ? `~dlq-${subscriber.queueName}` : null
}

/**
 * Returns the value of the given header
 */
export function getHeader(
  message: Message<any>,
  header: string
): string | undefined {
  const headers = message.headers
  const matchingHeader = Object.keys(headers).find(
    (currentHeader) => currentHeader.toLowerCase() === header.toLowerCase()
  )

  return matchingHeader !== undefined ? headers[matchingHeader] : undefined
}
