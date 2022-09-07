import { Announce } from '../Announce'
import { Message, Middleware, Subscriber } from '../types'

const doNothing = () => {}

export interface PublishDetails {
  announce: Announce
  message: Message<any>
}

export interface SubscribeDetails {
  announce: Announce
  subscriber: Subscriber<any>
}

export interface HandleDetails {
  announce: Announce
  message: Message<any>
  subscriber: Subscriber<any>
}

export interface SpyArgs {
  /**
   * Called whenever a message is about to be published
   */
  beforePublish?: (details: PublishDetails) => any

  /**
   * Notification that a message has been successfully published
   */
  onPublish?: (details: PublishDetails) => any

  /**
   * Notification that publishing failed
   */
  onPublishError?: (details: PublishDetails & { error: any }) => any

  /**
   * Called before a subscriber is added
   */
  beforeSubscribe?: (details: SubscribeDetails) => any

  /**
   * Notification that a subscriber was successfully added
   */
  onSubscribe?: (details: SubscribeDetails) => any

  /**
   * Notification that adding a subscriber failed
   */
  onSubscribeError?: (details: SubscribeDetails & { error: any }) => any

  /**
   * Called before a message is handled
   */
  beforeHandle?: (details: HandleDetails) => any

  /**
   * Notification that a message has been successfully handled
   */
  onHandle?: (details: HandleDetails) => any

  /**
   * Notification that a message was rejected by the handler
   */
  onHandleError?: (details: HandleDetails & { error: any }) => any
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
