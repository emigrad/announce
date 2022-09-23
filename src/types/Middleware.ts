import { Announce } from '../Announce'
import { Message, UnpublishedMessage } from './Message'
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
   */
  addHandleMiddleware: (handleMiddleware: HandleMiddleware) => void

  /**
   * Called whenever a queue is destroyed. Calling next(queueName) passes
   * the queue to the next middleware in the chain, or the backend if this
   * is the innermost middleware.
   */
  addDestroyQueueMiddleware: (
    destroyQueueMiddleware: DestroyQueueMiddleware
  ) => void

  /**
   * Publishes a message, bypassing any middleware that was added after this
   * middleware
   *
   * @param messages The messages to publish
   */
  publish: <Body>(
    ...messages: UnpublishedMessage<Body>[]
  ) => Promise<Message<Body>[]>

  /**
   * Destroys the given queue, bypassing any middleware that was added after
   * this middleware
   *
   * @param queueName The name of the queue to destroy
   */
  destroyQueue: (queueName: string) => Promise<void>
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

export interface DestroyQueueMiddleware {
  (args: DestroyQueueMiddlewareArgs): Promise<unknown>
}
export interface DestroyQueueMiddlewareArgs {
  queueName: string
  next: (queueName: string) => Promise<unknown>
}
