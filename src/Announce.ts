import cuid from 'cuid'
import { BackendFactory } from './backends/BackendFactory'
import {
  Backend,
  Headers,
  Message,
  Middleware,
  PublishMessage,
  Subscriber
} from './types'

export interface AnnounceOptions {
  backendFactory?: Pick<BackendFactory, 'getBackend'>
}

export class Announce {
  private readonly backend: Backend
  private readonly middlewares: Middleware[]

  constructor(
    private readonly url: string = process.env.ANNOUNCE_BACKEND_URL!,
    private readonly options: AnnounceOptions = {}
  ) {
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
    this.middlewares = []
  }

  /**
   * Adds the middleware to the chain. When processing a message or
   * subscriber, the middlewares are called in the order that they're added
   */
  use(middleware: Middleware) {
    this.middlewares.push(middleware)

    return this
  }

  subscribe: (...args: [...Middleware[], Subscriber<any>]) => Promise<void> = (
    ...args
  ) => {
    const backend = this.backend
    const announce = this
    const originalSubscriber = args[args.length - 1] as Subscriber<any>
    const middlewares = [
      ...this.middlewares,
      ...(args.slice(0, -1) as Middleware[])
    ]

    return next({ ...originalSubscriber }, 0)

    function next(
      subscriber: Subscriber<any>,
      middlewareNum: number
    ): Promise<void> {
      if (middlewareNum >= middlewares.length) {
        validateSubscriber(subscriber)
        return backend.subscribe(subscriber)
      }

      const middleware = middlewares[middlewareNum]
      if (middleware.handle) {
        const originalHandle = subscriber.handle.bind(subscriber)
        subscriber.handle = (message) => {
          return middleware.handle!({
            message,
            next: originalHandle,
            subscriber,
            announce
          })
        }
      }

      if (middleware.subscribe) {
        return middleware.subscribe({
          subscriber,
          next: (newSubscriber) => next(newSubscriber, middlewareNum + 1),
          announce
        })
      } else {
        return next(subscriber, middlewareNum + 1)
      }
    }
  }

  publish(message: PublishMessage<any>): Promise<void> {
    const { middlewares, backend } = this
    const announce = this
    const headers = { ...message.headers } as Headers

    if (headers.id === undefined) {
      headers.id = cuid()
    }
    if (headers.published === undefined) {
      headers.published = new Date().toISOString()
    }

    return next({ ...message, headers }, 0)

    function next(message: Message<any>, middlewareNum: number): Promise<void> {
      const middleware = middlewares[middlewareNum]

      if (!middleware) {
        try {
          validateMessage(message)
        } catch (e) {
          return Promise.reject(e)
        }
        return backend.publish(message)
      } else if (middleware.publish) {
        return middleware.publish({
          message,
          next: (newMessage) => next(newMessage, middlewareNum + 1),
          announce
        })
      } else {
        return next(message, middlewareNum + 1)
      }
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
