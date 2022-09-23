import assert from 'assert'
import createDebug from 'debug'
import { EventEmitter } from 'events'
import { deadLetterQueue } from '../polyfills'
import { Backend, BackendSubscriber, Message, Middleware } from '../types'
import { getConcurrency, getTopicSelectorRegExp } from '../util'

const debug = createDebug('announce:InMemory')

/**
 * An in-memory backend for running tests etc. Not suitable for production
 * use as unprocessed messages are lost when the application shuts down
 */
export class InMemoryBackend extends EventEmitter implements Backend {
  private readonly queuesByName: Record<string, Queue> = {}

  constructor() {
    super()
  }

  static accepts(url: string) {
    return url.startsWith('memory://')
  }

  async subscribe(subscriber: BackendSubscriber): Promise<void> {
    const queue = this.getQueue(subscriber.queueName)
    queue.subscriber = subscriber

    await this.bindQueue(subscriber.queueName, subscriber.topics)
  }

  /**
   * Publishes the message to all interested subscribers
   */
  async publish(message: Message<Buffer>) {
    this.getBoundQueues(message.topic).forEach((queue) => {
      queue.pendingMessages.push(message)
      this.watchPromise(this.processNextMessage(queue.name))
    })
  }

  async bindQueue(queueName: string, topics: readonly string[]): Promise<void> {
    const queue = this.getQueue(queueName)
    const existingBindings = queue.bindings
    const newBindings = topics.filter(
      (topic) => !existingBindings.includes(topic)
    )

    queue.bindings = [...existingBindings, ...newBindings]
  }

  async destroyQueue(queueName: string): Promise<void> {
    delete this.queuesByName[queueName]
  }

  async close() {
    await Promise.all(
      Object.keys(this.queuesByName).map((queueName) =>
        this.destroyQueue(queueName)
      )
    )
  }

  getPolyfills(): Middleware[] {
    return [deadLetterQueue(this)]
  }

  private getQueue(queueName: string): Queue
  private getQueue(queueName: string, createIfMissing: false): Queue | undefined
  private getQueue(queueName: string, createIfMissing = true) {
    if (!this.queuesByName[queueName] && createIfMissing) {
      this.queuesByName[queueName] = {
        name: queueName,
        bindings: [],
        pendingMessages: [],
        numMessagesProcessing: 0
      }
    }

    return this.queuesByName[queueName]
  }

  private getBoundQueues(topic: string): Queue[] {
    return Object.values(this.queuesByName).filter(({ bindings }) => {
      return bindings.some((binding) =>
        getTopicSelectorRegExp(binding).test(topic)
      )
    })
  }

  private async processNextMessage(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName, false)
    const subscriber = queue?.subscriber

    if (
      subscriber &&
      queue.pendingMessages.length &&
      queue.numMessagesProcessing < getConcurrency(subscriber)
    ) {
      const message = queue.pendingMessages.shift()
      assert(message)
      queue.numMessagesProcessing++

      try {
        await subscriber.handle(message)
      } catch (e) {
        // The deadLetterQueue polyfill provides dead letter support, so
        // normally we will never reach this point
        debug(`Message ${message.properties.id} was rejected`)
      } finally {
        queue.numMessagesProcessing--
        this.watchPromise(this.processNextMessage(queueName))
      }
    }
  }

  private watchPromise(promise: Promise<unknown>) {
    promise.catch((e) => this.emit('error', e))
  }
}

interface Queue {
  name: string
  bindings: string[]
  subscriber?: BackendSubscriber
  pendingMessages: Message<Buffer>[]
  numMessagesProcessing: number
}
