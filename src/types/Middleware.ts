import { Announce } from '../Announce'
import { Message } from './Message'
import { Subscriber } from './Subscriber'

export interface Middleware {
  (announce: Announce): MiddlewareInstance
}

export interface MiddlewareInstance {
  /**
   * Publishes a message to all interested subscribers. Calling
   * next(message) passes the message on to the next middleware
   * in the chain, or the backend if this is the innermost middleware. The
   * returned promise should be resolved once the middleware has finished
   * handling the message, just like a normal backend.
   */
  publish?: (args: PublishMiddlewareArgs) => Promise<void>

  /**
   * Called whenever a new subscriber is added. Calling next(subscriber) passes
   * the subscriber on to the next middleware in the chain, or the backend if this
   * is the innermost middleware. The returned promise should be resolved
   * once the subscriber has been successfully added to the backend.
   */
  subscribe?: (args: SubscribeMiddlewareArgs) => Promise<void>

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
  handle?: (args: HandleMiddlewareArgs) => Promise<void>
}

export interface PublishMiddlewareArgs {
  message: Message<any>
  next: (message: Message<any>) => Promise<void>
}

export interface SubscribeMiddlewareArgs {
  subscriber: Subscriber<any>
  next: (subscriber: Subscriber<any>) => Promise<void>
}

export interface HandleMiddlewareArgs {
  message: Message<any>
  subscriber: Subscriber<any>
  next: (message: Message<any>) => Promise<void>
}
