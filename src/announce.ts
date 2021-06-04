import { applyMiddlewares } from './middleware'
import { Backend, Message, Middleware, Subscriber } from './types'

export class Announce {
  constructor(
    private readonly backend: Backend,
    private readonly middlewares: Middleware<any, any>[]
  ) {}

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
