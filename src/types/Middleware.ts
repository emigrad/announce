import { Announce } from '../Announce'
import { Message } from './Message'
import { Subscriber } from './Subscriber'

export interface MiddlewareArgs {
  /**
   * The Announce instance that the middleware will be added to
   */
  announce: Announce

  /**
   * Adds middleware that is called when a message is published. Calling
   * next(message) passes the message on to the next middleware
   * in the chain, or the backend if this is the first middleware. The
   * returned promise should be resolved once the middleware has finished
   * handling the message, just like a normal backend.
   */
  addPublishMiddleware: (publishMiddleware: PublishMiddleware) => void

  /**
   * Adds middleware that's called whenever a subscriber is added. Calling
   * next(subscriber) passes the subscriber on to the next middleware in
   * the chain, or the backend if this is the first middleware. The
   * returned promise should be resolved once the subscriber has been
   * successfully added to the backend.
   */
  addSubscribeMiddleware: (subscribeMiddleware: SubscribeMiddleware) => void

  /**
   * Called whenever a message is received. Calling next(message) passes
   * the message on to the next middleware in the chain, or the handler if this
   * is the innermost middleware. The returned promise should be resolved
   * once the message has been successfully processed.
   *
   * If both subscribe and handle are defined, handle is processed first,
   * then provided as the handle() method in the subscriber passed to
   * subscribe()
   */
  addHandleMiddleware: (handleMiddleware: HandleMiddleware) => void
}

export interface Middleware {
  (args: MiddlewareArgs): void
}

export interface PublishMiddleware {
  (args: PublishMiddlewareArgs): Promise<unknown>
}
export interface PublishMiddlewareArgs {
  message: Message
  next: (message: Message) => Promise<unknown>
}

export interface SubscribeMiddleware {
  (args: SubscribeMiddlewareArgs): Promise<unknown>
}
export interface SubscribeMiddlewareArgs {
  subscriber: Subscriber
  next: (subscriber: Subscriber) => Promise<unknown>
}

export interface HandleMiddleware {
  (args: HandleMiddlewareArgs): Promise<unknown>
}
export interface HandleMiddlewareArgs {
  message: Message
  subscriber: Subscriber
  next: (message: Message) => Promise<unknown>
}
