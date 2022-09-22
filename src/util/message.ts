import cuid from 'cuid'
import {
  Message,
  MessageProperties,
  UnpublishedMessage,
  Subscriber,
  BackendSubscriber
} from '../types'

/**
 * Creates a new message for publication. Some message details such as
 * the ID and publication date will be generated when the message is published.
 */
export function createMessage<Body = unknown>(
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
export function getCompleteMessage<Body = unknown>(
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
export function getConcurrency(
  subscriber: Subscriber | BackendSubscriber
): number {
  return subscriber.options?.concurrency ?? 1
}

/**
 * Returns true if the subscriber has a dead letter topic
 */
export function hasDeadLetterTopic(
  subscriber: Subscriber | BackendSubscriber
): boolean {
  return subscriber.options?.preserveRejectedMessages !== false
}

/**
 * Returns the name of the subscriber's dead letter topic, or null if
 * it doesn't have one
 */
export function getDeadLetterTopic(
  subscriber: Subscriber | BackendSubscriber
): string | null {
  return hasDeadLetterTopic(subscriber)
    ? `~rejected-${subscriber.queueName}`
    : null
}

/**
 * Returns the name of the dead letter queue for the subscriber
 */
export function getDeadLetterQueueName(
  subscriber: Subscriber | BackendSubscriber
): string | null {
  return getDeadLetterTopic(subscriber)
}

// export function getOriginalQueueName()

/**
 * Returns the value of the given header
 */
export function getHeader(
  message: Message,
  header: string
): string | undefined {
  const headers = message.headers
  const matchingHeader = Object.keys(headers).find(
    (currentHeader) => currentHeader.toLowerCase() === header.toLowerCase()
  )

  return matchingHeader !== undefined ? headers[matchingHeader] : undefined
}
