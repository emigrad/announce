import { EventEmitter } from 'events'
import { BackendFactory } from './backends'
import {
  Backend,
  Message,
  Middleware,
  MiddlewareInstance,
  UnpublishedMessage,
  Subscriber
} from './types'
import { getCompleteMessage } from './util'

export interface AnnounceOptions {
  backendFactory?: Pick<BackendFactory, 'getBackend'>
}

export class Announce extends EventEmitter {
  private readonly backend: Backend
  private readonly middlewares: MiddlewareInstance[]
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
  use(...middlewares: Middleware[]): this {
    this.middlewares.push(
      ...middlewares.map((constructor) => constructor(this))
    )

    return this
  }

  /**
   * Returns a copy of the Announce instance with the middlewares added to the
   * chain. Use this instead of use() when you'd like the middlewares to be
   * active only for certain subscribers or publish calls.
   *
   * @example announce.with(delay(15000)).subscribe(mySubscriber) will
   *  subscribe mySubscriber, but it will receive the messages after a
   *  15 second delay
   */
  with(...middlewares: Middleware[]): Announce {
    const copy = Object.create(this, {
      middlewares: { value: [...this.middlewares] }
    })

    return copy.use(...middlewares)
  }

  async subscribe<Body extends any = any>(
    ...subscribers: Subscriber<Body>[]
  ): Promise<void> {
    await Promise.all(
      subscribers.map((subscriber) =>
        this._subscribe(cloneSubscriber(subscriber), this.middlewares)
      )
    )
  }

  async publish<Body extends any = any>(
    ...messages: UnpublishedMessage<Body>[]
  ): Promise<Message<Body>[]> {
    return Promise.all(
      messages.map(async (message) => {
        const completeMessage = getCompleteMessage(message)
        await this._publish(completeMessage, this.middlewares)

        return completeMessage
      })
    )
  }

  close() {
    if (!this.closePromise) {
      this.closePromise = this.backend
        .close()
        .catch(() => {})
        .then(() => {
          this.emit('close')
        })
    }

    return this.closePromise
  }

  destroy(err: any) {
    this.emit('error', err)
    return this.close()
  }

  private _subscribe(
    subscriber: Subscriber<any>,
    middlewares: readonly MiddlewareInstance[]
  ): Promise<void> {
    const announce = this
    const origHandle = subscriber.handle.bind(subscriber)

    if (!middlewares.length) {
      validateSubscriber(subscriber)
      return this.backend.subscribe({ ...subscriber, handle: next })
    }

    const [middleware, ...remainingMiddlewares] = middlewares
    if (middleware.handle) {
      subscriber.handle = (message) => {
        return middleware.handle!({ message, next, subscriber })
      }
    }

    if (middleware.subscribe) {
      return middleware.subscribe({
        subscriber,
        next: (newSubscriber) =>
          this._subscribe(newSubscriber, remainingMiddlewares)
      })
    } else {
      return this._subscribe(subscriber, remainingMiddlewares)
    }

    function next(message: Message<any>): Promise<void> {
      return origHandle(message, { announce })
    }
  }

  private _publish(
    message: Message<any>,
    middlewares: readonly MiddlewareInstance[]
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
        next: (newMessage) => this._publish(newMessage, remainingMiddlewares)
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

/**
 * Clones a subscriber so that we work correctly with subscribers where
 * one or more properties exists in the object's prototype chain rather than
 * on the object itself (eg subscribers that are classes)
 */
function cloneSubscriber(subscriber: Subscriber<any>): Subscriber<any> {
  return {
    name: subscriber.name,
    topics: subscriber.topics,
    options: subscriber.options,
    handle: subscriber.handle.bind(subscriber)
  }
}
