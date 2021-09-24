import { BackendFactory } from './backends/BackendFactory'
import { applyMiddlewares } from './middleware'
import { Backend, Message, Middleware, Subscriber } from './types'

export interface AnnounceOptions {
  backendFactory?: Pick<BackendFactory, 'getBackend'>
}

export class Announce {
  private readonly backend: Backend

  constructor(
    private readonly url: string = process.env.ANNOUNCE_BACKEND_URL!,
    private readonly middlewares: Middleware<any, any>[] = [],
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
  }

  publish(message: Message<any>) {
    if (!isValidTopic(message.topic)) {
      throw new Error(`Invalid topic: ${message.topic}`)
    }

    return this.backend.publish(message)
  }

  subscribe(subscriber: Subscriber<any, any>) {
    const invalidTopics = subscriber.topics.filter(
      (topic) => !isValidTopicSelector(topic)
    )
    if (invalidTopics.length) {
      throw new Error(`Invalid topic selector(s): ${invalidTopics.join(', ')}`)
    }

    this.backend.subscribe(applyMiddlewares(...this.middlewares)(subscriber))
  }
}

function isValidTopic(topic: string) {
  return /^[0-9A-Z_]+(\.[0-9A-Z_]+)*$/i.test(topic)
}

function isValidTopicSelector(topicSelector: string) {
  return /^(\*|\*\*|[A-Z0-9_]+)(\.(\*|\*\*|[A-Z0-9_]+))*$/i.test(topicSelector)
}
