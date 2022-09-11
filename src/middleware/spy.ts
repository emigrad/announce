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
    onHandleError = doNothing
  } = listeners

  return ({
    announce,
    addPublishMiddleware,
    addSubscribeMiddleware,
    addHandleMiddleware
  }) => {
    addPublishMiddleware(async ({ message, next }) => {
      beforePublish({ message, announce })

      try {
        await next(message)
        onPublish({ message, announce })
      } catch (error) {
        onPublishError({ error, message, announce })
        throw error
      }
    })

    addSubscribeMiddleware(async ({ subscriber, next }) => {
      beforeSubscribe({ subscriber, announce })

      try {
        await next(subscriber)
        onSubscribe({ subscriber, announce })
      } catch (error) {
        onSubscribeError({ subscriber, error, announce })
        throw error
      }
    })

    addHandleMiddleware(async ({ message, subscriber, next }) => {
      beforeHandle({ message, subscriber, announce })

      try {
        await next(message)
        onHandle({ message, subscriber, announce })
      } catch (error) {
        onHandleError({ error, message, subscriber, announce })
        throw error
      }
    })
  }
}

function doNothing() {
  // Do nothing
}
