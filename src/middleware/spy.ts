import { Announce } from '../Announce'
import { Message, Middleware, Subscriber } from '../types'

export interface PublishDetails {
  announce: Announce
  message: Message
}

export interface SubscribeDetails {
  announce: Announce
  subscriber: Subscriber
}

export interface HandleDetails {
  announce: Announce
  message: Message
  subscriber: Subscriber
}

export interface DestroyQueueDetails {
  announce: Announce
  queueName: string
}

export interface SpyArgs {
  /**
   * Called whenever a message is about to be published
   */
  beforePublish?: (details: PublishDetails) => unknown

  /**
   * Notification that a message has been successfully published
   */
  onPublish?: (details: PublishDetails) => unknown

  /**
   * Notification that publishing failed
   */
  onPublishError?: (details: PublishDetails & { error: unknown }) => unknown

  /**
   * Called before a subscriber is added
   */
  beforeSubscribe?: (details: SubscribeDetails) => unknown

  /**
   * Notification that a subscriber was successfully added
   */
  onSubscribe?: (details: SubscribeDetails) => unknown

  /**
   * Notification that adding a subscriber failed
   */
  onSubscribeError?: (details: SubscribeDetails & { error: unknown }) => unknown

  /**
   * Called before a message is handled
   */
  beforeHandle?: (details: HandleDetails) => unknown

  /**
   * Notification that a message has been successfully handled
   */
  onHandle?: (details: HandleDetails) => unknown

  /**
   * Notification that a message was rejected by the handler
   */
  onHandleError?: (details: HandleDetails & { error: unknown }) => unknown

  /**
   * Called before a queue is destroyed
   */
  beforeDestroyQueue?: (details: DestroyQueueDetails) => unknown

  /**
   * Notification that a queue has been destroyed
   */
  onDestroyQueue?: (details: DestroyQueueDetails) => unknown

  /**
   * Notification that an attempt to destroy a queue failed
   */
  onDestroyQueueError?: (
    details: DestroyQueueDetails & { error: unknown }
  ) => unknown
}

/**
 * Spies on an Announce instance. This can be useful for logging or
 * debugging etc
 */
export function spy(listeners: SpyArgs): Middleware {
  const {
    beforePublish = doNothing,
    onPublish = doNothing,
    onPublishError = doNothing,
    beforeSubscribe = doNothing,
    onSubscribe = doNothing,
    onSubscribeError = doNothing,
    beforeHandle = doNothing,
    onHandle = doNothing,
    onHandleError = doNothing,
    beforeDestroyQueue = doNothing,
    onDestroyQueue = doNothing,
    onDestroyQueueError = doNothing
  } = listeners

  return ({
    announce,
    addPublishMiddleware,
    addSubscribeMiddleware,
    addHandleMiddleware,
    addDestroyQueueMiddleware
  }) => {
    addPublishMiddleware(async ({ message, next }) => {
      await beforePublish({ message, announce })

      try {
        await next(message)
        await onPublish({ message, announce })
      } catch (error) {
        await onPublishError({ error, message, announce })
        throw error
      }
    })

    addSubscribeMiddleware(async ({ subscriber, next }) => {
      await beforeSubscribe({ subscriber, announce })

      try {
        await next(subscriber)
        await onSubscribe({ subscriber, announce })
      } catch (error) {
        await onSubscribeError({ subscriber, error, announce })
        throw error
      }
    })

    addHandleMiddleware(async ({ message, subscriber, next }) => {
      await beforeHandle({ message, subscriber, announce })

      try {
        await next(message)
        await onHandle({ message, subscriber, announce })
      } catch (error) {
        await onHandleError({ error, message, subscriber, announce })
        throw error
      }
    })

    addDestroyQueueMiddleware(async ({ queueName, next }) => {
      await beforeDestroyQueue({ queueName, announce })

      try {
        await next(queueName)
        await onDestroyQueue({ queueName, announce })
      } catch (error) {
        await onDestroyQueueError({ queueName, announce, error })
        throw error
      }
    })
  }
}

function doNothing() {
  // Do nothing
}
