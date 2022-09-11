import { EventEmitter } from 'events'
import { backendFactory } from './backends'
import {
  Backend,
  BackendFactory,
  BackendSubscriber,
  Message,
  Middleware,
  PublishMiddleware,
  SubscribeMiddleware,
  Subscriber,
  UnpublishedMessage
} from './types'
import { getCompleteMessage, handleToSubscriberMiddleware } from './util'

export interface AnnounceArgs {
  /** The URL of the backend to connect to */
  url?: string
  /** The factory to construct backends */
  backendFactory?: BackendFactory
}

const DEFAULT_BACKEND_FACTORY = backendFactory()

export class Announce extends EventEmitter {
  private readonly backend: Backend
  private readonly subscribeMiddlewares: SubscribeMiddleware[] = []
  private readonly publishMiddlewares: PublishMiddleware[] = []
  private closePromise: Promise<void> | undefined

  constructor({
    url = process.env.ANNOUNCE_BACKEND_URL,
    backendFactory = DEFAULT_BACKEND_FACTORY
  }: AnnounceArgs = {}) {
    super()

    const backend = backendFactory(url ?? '')

    if (!backend && !url) {
      throw new Error(
        'Backend URL not defined - either set the environment variable ANNOUNCE_BACKEND_URL ' +
          'or pass in {url: ...} as a parameter. "memory://" is a good value to get started with ' +
          'for local development, but for production use you almost certainly want to use an ' +
          'external message broker. See README.md for a list of supported backends.'
      )
    } else if (!backend) {
      throw new Error(
        `Unsupported backend url: ${url}. See README.md for a list of supported backends.`
      )
    }

    this.backend = backend
    this.backend.on('error', this.destroy.bind(this))
  }

  /**
   * Adds the middlewares to the chain. When adding a subscriber or
   * publishing a message, the last-added middleware is called first. When
   * handling a message, the innermost middleware is called first.
   */
  use(...middlewares: Middleware[]): this {
    middlewares.forEach((middlewareConstructor) => {
      let finished = false

      middlewareConstructor({
        announce: this,
        addHandleMiddleware: (handleMiddleware) => {
          if (!finished) {
            this.subscribeMiddlewares.push(
              handleToSubscriberMiddleware(handleMiddleware, { announce: this })
            )
          } else {
            throw new Error(
              "addHandleMiddleware() must be called from inside the middleware function, it can't be called after it has returned"
            )
          }
        },
        addPublishMiddleware: (publishMiddleware) => {
          if (!finished) {
            this.publishMiddlewares.push(publishMiddleware)
          } else {
            throw new Error(
              "addPublishMiddleware() must be called from inside the middleware function, it can't be called after it has returned"
            )
          }
        },
        addSubscribeMiddleware: (subscribeMiddleware) => {
          if (!finished) {
            this.subscribeMiddlewares.push(subscribeMiddleware)
          } else {
            throw new Error(
              "addSubscribeMiddleware() must be called from inside the middleware function, it can't be called after it has returned"
            )
          }
        }
      })

      finished = true
    })

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
      subscribeMiddlewares: { value: [...this.subscribeMiddlewares] },
      publishMiddlewares: { value: [...this.publishMiddlewares] }
    })

    return copy.use(...middlewares)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async subscribe(...subscribers: Subscriber<any>[]): Promise<void> {
    await Promise.all(
      subscribers.map((subscriber) =>
        this._subscribe(cloneSubscriber(subscriber), this.subscribeMiddlewares)
      )
    )
  }

  async publish<Body = unknown>(
    ...messages: UnpublishedMessage<Body>[]
  ): Promise<Message<Body>[]> {
    return Promise.all(
      messages.map(async (message) => {
        const completeMessage = getCompleteMessage(message)
        await this._publish(completeMessage, this.publishMiddlewares)

        return completeMessage
      })
    )
  }

  close() {
    if (!this.closePromise) {
      this.closePromise = this.backend
        .close()
        .catch(() => {
          // Squelch
        })
        .then(() => {
          this.emit('close')
        })
    }

    return this.closePromise
  }

  destroy(err: unknown) {
    this.emit('error', err)
    return this.close()
  }

  private async _subscribe(
    subscriber: Subscriber,
    middlewares: readonly SubscribeMiddleware[]
  ): Promise<void> {
    const middleware = middlewares[middlewares.length - 1]
    const remainingMiddlewares = middlewares.slice(0, middlewares.length - 1)

    if (middleware) {
      await middleware({
        subscriber,
        next: (newSubscriber) =>
          this._subscribe(newSubscriber, remainingMiddlewares)
      })
    } else {
      validateSubscriber(subscriber)
      return this.backend.subscribe(subscriber as BackendSubscriber)
    }
  }

  private async _publish(
    message: Message,
    middlewares: readonly PublishMiddleware[]
  ): Promise<void> {
    const middleware = middlewares[middlewares.length - 1]
    const remainingMiddlewares = middlewares.slice(0, middlewares.length - 1)

    if (middleware) {
      await middleware({
        message,
        next: (newMessage) => this._publish(newMessage, remainingMiddlewares)
      })
    } else {
      try {
        validateMessage(message)
      } catch (e) {
        return Promise.reject(e)
      }
      return this.backend.publish(message)
    }
  }
}

function isValidTopic(topic: string) {
  return /^[0-9A-Z_~]+(\.[0-9A-Z_~]+)*$/i.test(topic)
}

function isValidTopicSelector(topicSelector: string) {
  return /^(\*|\*\*|[A-Z0-9_~]+)(\.(\*|\*\*|[A-Z0-9_~]+))*$/i.test(
    topicSelector
  )
}

/**
 * Throws an error if the subscriber is invalid for some reason
 */
function validateSubscriber(subscriber: Subscriber) {
  const invalidTopics = subscriber.topics.filter(
    (topic) => !isValidTopicSelector(topic)
  )
  if (invalidTopics.length) {
    throw new Error(
      `Invalid topic selector(s): ${invalidTopics.join(', ')}. Topic `
    )
  }
}

function validateMessage(message: Message): asserts message is Message<Buffer> {
  if (!isValidTopic(message.topic)) {
    throw new Error(`Invalid topic: ${message.topic}`)
  } else if (!(message.body instanceof Buffer)) {
    throw new Error(
      'Message body must be a Buffer. Consider using the json() middleware to automatically serialise and deserialise messages'
    )
  }
}

/**
 * Clones a subscriber so that we work correctly with subscribers where
 * one or more properties exists in the object's prototype chain rather than
 * on the object itself (eg subscribers that are classes)
 */
function cloneSubscriber(subscriber: Subscriber): Subscriber {
  return {
    queueName: subscriber.queueName,
    topics: subscriber.topics,
    options: subscriber.options,
    handle: subscriber.handle.bind(subscriber)
  }
}
