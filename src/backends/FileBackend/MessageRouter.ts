import chokidar, { FSWatcher } from 'chokidar'
import createDebug from 'debug'
import { join, resolve } from 'path'
import { mkdir as mkdirCb, readFile as readFileCb } from 'fs'
import { prop } from 'rambda'
import { promisify } from 'util'
import { BackendSubscriber, Message } from '../../types'
import {
  PROCESSING_DIRECTORY,
  QUEUES_DIRECTORY,
  READY_DIRECTORY,
  SUBSCRIPTIONS_DIRECTORY
} from './constants'
import {
  atomicWriteFile,
  getQueueNameFromSubscriberPath,
  getQueuePath,
  isFileNotFoundError,
  serializeMessage,
  waitForReady
} from './util'

const debug = createDebug('announce:FileBackend:MessageRouter')
const mkdir = promisify(mkdirCb)
const readFile = promisify(readFileCb)

export class MessageRouter {
  public readonly ready: Promise<void>
  private readonly queuesPath: string
  private readonly subscriptionsPath: string
  private subscriptionsWatcher!: FSWatcher
  private readonly externalSubscribers: Record<string, ExternalSubscriber> = {}

  constructor(basePath: string) {
    this.queuesPath = resolve(basePath, QUEUES_DIRECTORY)
    this.subscriptionsPath = resolve(basePath, SUBSCRIPTIONS_DIRECTORY)

    this.ready = this.initialize()
  }

  async subscriberChanged(subscriberPath: string): Promise<void> {
    await this.onSubscriberChanged(subscriberPath)
  }

  async publish(message: Message<Buffer>): Promise<void> {
    await this.ready
    const queueNames = Object.values(this.externalSubscribers)
      .filter(subscribesTo(message.topic))
      .map(prop('queueName'))

    await Promise.all(
      queueNames.map((queueName) => this.addToQueue(message, queueName))
    )
  }

  async close(): Promise<void> {
    await this.subscriptionsWatcher.close()
  }

  private async initialize(): Promise<void> {
    await mkdir(this.subscriptionsPath, { recursive: true })

    this.subscriptionsWatcher = chokidar
      .watch(join(this.subscriptionsPath, '*.json'))
      .on('add', (path) => this.onSubscriberChanged(path))
      .on('change', (path) => this.onSubscriberChanged(path))
      .on('unlink', (path) => this.onSubscriberRemoved(path))

    await waitForReady(this.subscriptionsWatcher)
  }

  /**
   * Adds the message to the queue on disk
   */
  private async addToQueue(
    message: Message<Buffer>,
    queue: string
  ): Promise<void> {
    const path = this.getMessagePath(message, queue)
    const contents = serializeMessage(message)

    try {
      await atomicWriteFile(path, contents)
    } catch (e: unknown) {
      if (isFileNotFoundError(e)) {
        // Likely the queue path has been deleted, which means something's
        // in the process of removing this subscription
      } else {
        throw e
      }
    }

    debug(`Wrote message ${message.properties.id} to ${path}`)
  }

  /**
   * Returns the path of the message in the given queue
   */
  private getMessagePath(message: Message<Buffer>, queueName: string): string {
    return join(
      getQueuePath(this.queuesPath, queueName),
      READY_DIRECTORY,
      `${encodeURIComponent(message.properties.id)}_${randomString()}.json`
    )
  }

  private async onSubscriberChanged(path: string): Promise<void> {
    const fileContents = await readFile(path)
    const externalSubscriber: ExternalSubscriber = JSON.parse(
      fileContents.toString()
    )

    await this.createQueuePaths(externalSubscriber.queueName)
    this.externalSubscribers[externalSubscriber.queueName] = externalSubscriber

    debug(`Subscriber changed: ${path}`)
  }

  private async onSubscriberRemoved(path: string): Promise<void> {
    delete this.externalSubscribers[getQueueNameFromSubscriberPath(path)]

    debug(`Subscriber removed: ${path}`)
  }

  /**
   * Creates the directory in which we will store all the messages for the
   * queue
   */
  private async createQueuePaths(queueName: string): Promise<void> {
    await mkdir(
      join(getQueuePath(this.queuesPath, queueName), READY_DIRECTORY),
      {
        recursive: true
      }
    )
    await mkdir(
      join(getQueuePath(this.queuesPath, queueName), PROCESSING_DIRECTORY),
      {
        recursive: true
      }
    )
  }
}

function subscribesTo(
  topic: string
): (subscriber: ExternalSubscriber) => boolean {
  return (subscriber) =>
    subscriber.topics.some((topicSelector) =>
      getTopicSelectorRegExp(topicSelector).test(topic)
    )
}

function getTopicSelectorRegExp(topicSelector: string): RegExp {
  const regExpStr = topicSelector
    .replace(/\./g, '\\.')
    .replace(/\*\*?/g, (match) => (match === '**' ? '.*' : '[^.]+'))

  return new RegExp(`^${regExpStr}$`)
}

function randomString(): string {
  return String(Math.random()).substring(2)
}

type ExternalSubscriber = Pick<BackendSubscriber, 'queueName' | 'topics'>
