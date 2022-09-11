import assert from 'assert'
import cuid from 'cuid'
import {
  mkdir as mkdirCb,
  readdir as readdirCb,
  readFile as readFileCb,
  unlink as unlinkCb,
  writeFile as writeFileCb
} from 'fs'
import { resolve } from 'path'
import { promisify } from 'util'
import { getDeadLetterTopic, hasDeadLetterTopic } from '../util'
import { BackendSubscriber, Message, Subscriber } from '../types'
import { LocalBackend, SubscriberWithQueue } from './LocalBackend'

const mkdir = promisify(mkdirCb)
const readdir = promisify(readdirCb)
const readFile = promisify(readFileCb)
const unlink = promisify(unlinkCb)
const writeFile = promisify(writeFileCb)

const fileIdHeader = 'x-file-id'

/**
 * A backend that's backed by the filesystem to ensure at-least-once delivery.
 * This backend is suitable for light production use where there is only a
 * single instance of the backend running.
 *
 * Supports:
 *  - guaranteed delivery
 *  - dead letter queues
 *
 * Does not support:
 *  - inter-service messaging
 *  - multiple instances
 */
export class FileBackend extends LocalBackend {
  private readonly queuePath: string

  static accepts(url: string) {
    return url.startsWith('file://')
  }

  constructor(path: string) {
    super()

    this.queuePath = resolve(path, 'queues')
  }

  async subscribe(subscriber: BackendSubscriber): Promise<void> {
    await super.subscribe(subscriber)
    await this.queuePersistedMessages(subscriber)
  }

  async publish(message: Message<Buffer>): Promise<void> {
    await Promise.all(
      this.getMatchingSubscribers(message).map(async (subscriber) => {
        await this.enqueue(message, subscriber.queueName)
      })
    )
  }

  /**
   * Loads all of the persisted messages into the in-memory queue
   */
  private async queuePersistedMessages(
    subscriber: Subscriber<Buffer>
  ): Promise<void> {
    const persistedMessages = await this.loadPersistedMessages(subscriber)

    persistedMessages.forEach((message) =>
      this.addToInMemoryQueue(message, subscriber.queueName)
    )
  }

  /**
   * Loads all of the messages that have been persisted for the given
   * subscriber
   */
  private async loadPersistedMessages(
    subscriber: Subscriber<Buffer>
  ): Promise<Message<Buffer>[]> {
    const messageIds = await this.getPersistedMessageIds(subscriber)

    return Promise.all(
      messageIds.map((id) => this.loadPersistedMessage(subscriber, id))
    )
  }

  /**
   * Retrieves the IDs of the messages that have been persisted for the
   * given queue. The message IDs will be returned oldest first
   */
  private async getPersistedMessageIds(
    subscriber: Subscriber<Buffer>
  ): Promise<string[]> {
    try {
      return (await readdir(this.getQueuePath(subscriber.queueName))).sort()
    } catch (e) {
      if (e.code === 'ENOENT') {
        return []
      } else {
        throw e
      }
    }
  }

  /**
   * Loads a persisted message from disk
   */
  private async loadPersistedMessage(
    subscriber: Subscriber<Buffer>,
    id: string
  ): Promise<Message<Buffer>> {
    const path = this.getMessagePathFromId(id, subscriber.queueName)
    const rawMessage = await readFile(path, 'utf8')

    const parsedMessage = JSON.parse(rawMessage) as Message<string>
    parsedMessage.properties.date = new Date(parsedMessage.properties.date)
    return { ...parsedMessage, body: Buffer.from(parsedMessage.body, 'base64') }
  }

  /**
   * Adds the message to both the persisted and in-memory queues
   */
  private async enqueue(
    message: Message<Buffer>,
    queue: string
  ): Promise<void> {
    message = addMetadata(message)

    await this.addToPersistedQueue(message, queue)
    this.addToInMemoryQueue(message, queue)
  }

  /**
   * Adds the message to the in-memory queue
   */
  private addToInMemoryQueue(message: Message<Buffer>, queue: string) {
    const subscriber = this.getSubscriberForQueue(queue)
    if (!subscriber) {
      return
    }

    subscriber.queue
      .add(() => this.handleMessage(message, subscriber))
      .catch((e) => this.emit('error', e))
  }

  /**
   * Gets the subscriber that handles messages for the given queue, if any
   */
  private getSubscriberForQueue(
    queue: string
  ): SubscriberWithQueue | undefined {
    return this.subscribers.find(({ queueName }) => queueName === queue)
  }

  /**
   * Adds the message to the queue on disk
   */
  private async addToPersistedQueue(
    message: Message<Buffer>,
    queue: string
  ): Promise<void> {
    await this.createQueuePath(queue)

    return writeFile(
      this.getMessagePath(message, queue),
      JSON.stringify({ ...message, body: message.body.toString('base64') })
    )
  }

  /**
   * Gets the subscriber to handle the message
   */
  private async handleMessage(
    message: Message<Buffer>,
    subscriber: SubscriberWithQueue
  ) {
    try {
      await subscriber.handle(message)
    } catch (e) {
      if (hasDeadLetterTopic(subscriber)) {
        const deadLetterTopic = getDeadLetterTopic(subscriber)
        assert(deadLetterTopic)

        await this.enqueue(message, deadLetterTopic)
      }
    }

    await this.removeFromPersistedQueue(message, subscriber.queueName)
  }

  /**
   * Removes the message from the given queue on dist
   */
  private removeFromPersistedQueue(
    message: Message<Buffer>,
    queue: string
  ): Promise<void> {
    return unlink(this.getMessagePath(message, queue))
  }

  /**
   * Creates the directory in which we will store all the messages for the
   * queue
   */
  private async createQueuePath(queue: string): Promise<void> {
    await mkdir(this.getQueuePath(queue), { recursive: true })
  }

  /**
   * Returns the directory to store messages for the given queue in
   */
  private getQueuePath(queue: string): string {
    return resolve(this.queuePath, queue)
  }

  /**
   * Returns the path of the message in the given queue
   */
  private getMessagePath(message: Message<Buffer>, queue: string): string {
    return this.getMessagePathFromId(message.headers[fileIdHeader], queue)
  }

  /**
   * Returns the path corresponding to the given message ID and queue
   */
  private getMessagePathFromId(messageId: string, queue: string): string {
    return resolve(this.getQueuePath(queue), messageId)
  }
}

/**
 * Adds our metadata to the message
 */
function addMetadata(message: Message<Buffer>): Message<Buffer> {
  return {
    ...message,
    headers: { ...message.headers, [fileIdHeader]: cuid() }
  }
}
