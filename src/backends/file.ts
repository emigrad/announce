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
import { getDeadLetterQueue, hasDeadLetterQueue } from '../selectors'
import { Logger, Message, Subscriber } from '../types'
import { LocalBackend, SubscriberWithQueue } from './local'

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

  constructor(path: string, private readonly logger?: Logger) {
    super()

    this.queuePath = resolve(path, 'queues')
  }

  async subscribe(subscriber: Subscriber<any, any>): Promise<void> {
    await super.subscribe(subscriber)
    await this.queuePersistedMessages(subscriber)
  }

  async publish(message: Message<any>): Promise<void> {
    await Promise.all(
      this.getMatchingSubscribers(message).map(async (subscriber) => {
        await this.enqueue(message, subscriber.name)
      })
    )
  }

  /**
   * Loads all of the persisted messages into the in-memory queue
   */
  private async queuePersistedMessages(
    subscriber: Subscriber<any>
  ): Promise<void> {
    const persistedMessages = await this.loadPersistedMessages(subscriber)

    persistedMessages.forEach((message) =>
      this.addToInMemoryQueue(message, subscriber.name)
    )
  }

  /**
   * Loads all of the messages that have been persisted for the given
   * subscriber
   */
  private async loadPersistedMessages(
    subscriber: Subscriber<any>
  ): Promise<Message<any>[]> {
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
    subscriber: Subscriber<any>
  ): Promise<string[]> {
    try {
      return (await readdir(this.getQueuePath(subscriber.name))).sort()
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
    subscriber: Subscriber<any>,
    id: string
  ): Promise<Message<any>> {
    const path = this.getMessagePathFromId(id, subscriber.name)
    const rawMessage = await readFile(path, 'utf8')

    return JSON.parse(rawMessage)
  }

  /**
   * Adds the message to both the persisted and in-memory queues
   */
  private async enqueue(message: Message<any>, queue: string): Promise<void> {
    message = addMetadata(message)

    await this.addToPersistedQueue(message, queue)
    this.addToInMemoryQueue(message, queue)
  }

  /**
   * Adds the message to the in-memory queue
   */
  private addToInMemoryQueue(message: Message<any>, queue: string) {
    const subscriber = this.getSubscriberForQueue(queue)
    if (!subscriber) {
      return
    }

    subscriber.queue
      .add(() => this.handleMessage(message, subscriber))
      .catch((e) => {
        this.logError(e)
      })
  }

  /**
   * Gets the subscriber that handles messages for the given queue, if any
   */
  private getSubscriberForQueue(
    queue: string
  ): SubscriberWithQueue | undefined {
    return this.subscribers.find(({ name }) => name === queue)
  }

  /**
   * Adds the message to the queue on disk
   */
  private async addToPersistedQueue(
    message: Message<any>,
    queue: string
  ): Promise<void> {
    await this.createQueuePath(queue)

    return writeFile(
      this.getMessagePath(message, queue),
      JSON.stringify(message)
    )
  }

  /**
   * Gets the subscriber to handle the message
   */
  private async handleMessage(
    message: Message<any>,
    subscriber: SubscriberWithQueue
  ) {
    try {
      await subscriber.handle((message as Message<any>).body, message)
    } catch (e) {
      if (hasDeadLetterQueue(subscriber)) {
        await this.enqueue(message, getDeadLetterQueue(subscriber)!)
      }
    }

    await this.removeFromPersistedQueue(message, subscriber.name)
  }

  /**
   * Removes the message from the given queue on dist
   */
  private removeFromPersistedQueue(
    message: Message<any>,
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
  private getMessagePath(message: Message<any>, queue: string): string {
    return this.getMessagePathFromId(message.headers[fileIdHeader], queue)
  }

  /**
   * Returns the path corresponding to the given message ID and queue
   */
  private getMessagePathFromId(messageId: string, queue: string): string {
    return resolve(this.getQueuePath(queue), messageId)
  }

  /**
   * Logs an error with the logger, if provided
   */
  private logError(error: any) {
    if (this.logger) {
      if (error.message) {
        this.logger.error(error.message, { error })
      } else {
        this.logger.error(error)
      }
    }
  }
}

/**
 * Adds our metadata to the message
 */
function addMetadata(message: Message<any>): Message<any> {
  return {
    ...message,
    headers: { ...message.headers, [fileIdHeader]: cuid() }
  }
}
