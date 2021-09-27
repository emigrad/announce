import { EventEmitter } from 'events'
import { BackendFactory } from './backends'
import { getCompleteHeaders } from './message'
import {
  Backend,
  Message,
  Middleware,
  PublishMessage,
  Subscriber
} from './types'

export interface AnnounceOptions {
  backendFactory?: Pick<BackendFactory, 'getBackend'>
}

export class Announce extends EventEmitter {
  private readonly backend: Backend
  private readonly middlewares: Middleware[]
  private closePromise: Promise<void> | undefined

  constructor(
    private readonly url: string = process.env.ANNOUNCE_BACKEND_URL!,
    private readonly options: AnnounceOptions = {}
  ) {
    super()

    const { backendFactory = new BackendFactory() } = options
    const backend = backendFactory.getBackend(url ?? '')

    if (!url) {
      throw new Error(
        'Backend URL not defined - did you set ANNOUNCE_BACKEND_URL?'
      )
    } else if (!backend) {
      throw new Error(`Unsupported backend url: ${url}`)
    }

    this.backend = backend
    this.backend.on('error', this.destroy.bind(this))
    this.middlewares = []
  }

  /**
   * Adds the middlewares to the chain. When processing a message or
   * subscriber, the middlewares are called in the order that they're added
   */
  use(...middlewares: Middleware[]) {
    this.middlewares.push(...middlewares)

    return this
  }

  subscribe<Body extends any = any>(
    subscriber: Subscriber<Body>
  ): Promise<void> {
    return this._subscribe(subscriber, this.middlewares)
  }

  publish(message: PublishMessage<any>): Promise<void> {
    return this._publish(
      { ...message, headers: getCompleteHeaders({ ...message.headers }) },
      this.middlewares
    )
  }

  async close() {
    if (!this.closePromise) {
      this.closePromise = this.backend.close()
    }

    return this.closePromise
  }

  destroy(err: any) {
    this.emit('error', err)
    this.close().catch(() => {
      // We don't care about any errors when trying to shut down
    })
  }

  private _subscribe(
    subscriber: Subscriber<any>,
    middlewares: readonly Middleware[]
  ): Promise<void> {
    if (!middlewares.length) {
      validateSubscriber(subscriber)
      return this.backend.subscribe(subscriber)
    }

    const [middleware, ...remainingMiddlewares] = middlewares
    if (middleware.handle) {
      const originalHandle = subscriber.handle.bind(subscriber)
      subscriber.handle = (message) => {
        return middleware.handle!({
          message,
          next: originalHandle,
          subscriber,
          announce: this
        })
      }
    }

    if (middleware.subscribe) {
      return middleware.subscribe({
        subscriber,
        next: (newSubscriber) =>
          this._subscribe(newSubscriber, remainingMiddlewares),
        announce: this
      })
    } else {
      return this._subscribe(subscriber, remainingMiddlewares)
    }
  }

  private _publish(
    message: Message<any>,
    middlewares: readonly Middleware[]
  ): Promise<void> {
    const [middleware, ...remainingMiddlewares] = middlewares

    if (!middleware) {
      try {
        validateMessage(message)
      } catch (e) {
        return Promise.reject(e)
      }
      return this.backend.publish(message)
    } else if (middleware.publish) {
      return middleware.publish({
        message,
        next: (newMessage) => this._publish(newMessage, remainingMiddlewares),
        announce: this
      })
    } else {
      return this._publish(message, remainingMiddlewares)
    }
  }
}

function isValidTopic(topic: string) {
  return /^[0-9A-Z_]+(\.[0-9A-Z_]+)*$/i.test(topic)
}

function isValidTopicSelector(topicSelector: string) {
  return /^(\*|\*\*|[A-Z0-9_]+)(\.(\*|\*\*|[A-Z0-9_]+))*$/i.test(topicSelector)
}

/**
 * Throws an error if the subscriber is invalid for some reason
 */
function validateSubscriber(subscriber: Subscriber<any>) {
  const invalidTopics = subscriber.topics.filter(
    (topic) => !isValidTopicSelector(topic)
  )
  if (invalidTopics.length) {
    throw new Error(`Invalid topic selector(s): ${invalidTopics.join(', ')}`)
  }
}

function validateMessage(message: Message<any>) {
  if (!isValidTopic(message.topic)) {
    throw new Error(`Invalid topic: ${message.topic}`)
  } else if (!(message.body instanceof Buffer)) {
    throw new Error('Message body must be a Buffer')
  }
}
