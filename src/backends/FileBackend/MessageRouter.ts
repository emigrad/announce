import chokidar, { FSWatcher } from 'chokidar'
import createDebug from 'debug'
import { EventEmitter } from 'events'
import { mkdir as mkdirCb, readFile as readFileCb } from 'fs'
import { join, resolve } from 'path'
import { prop } from 'rambda'
import { promisify } from 'util'
import { Message } from '../../types'
import { getTopicSelectorRegExp } from '../../util'
import {
  PROCESSING_DIRECTORY,
  QUEUES_DIRECTORY,
  READY_DIRECTORY,
  SUBSCRIPTIONS_DIRECTORY
} from './constants'
import { ExternalSubscriber } from './types'
import {
  atomicWriteFile,
  getQueueNameFromSubscriberPath,
  getQueuePath,
  ignoreFileNotFoundErrors,
  serializeMessage,
  waitForReady
} from './util'

const debug = createDebug('announce:FileBackend:MessageRouter')
const mkdir = promisify(mkdirCb)
const readFile = promisify(readFileCb)

export class MessageRouter extends EventEmitter {
  public readonly ready: Promise<void>
  private readonly queuesPath: string
  private readonly subscriptionsPath: string
  private subscriptionsWatcher!: FSWatcher
  private readonly externalSubscribers: Record<string, ExternalSubscriber> = {}
  private readonly timers: NodeJS.Timer[] = []

  constructor(basePath: string) {
    super()

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

    debug(
      `Delivering message ${message.properties.id} to queues ${JSON.stringify(
        queueNames
      )}`
    )

    await Promise.all(
      queueNames.map((queueName) => this.addToQueue(message, queueName))
    )
  }

  async close(): Promise<void> {
    await this.subscriptionsWatcher.close()
    this.timers.forEach((timer) => clearTimeout(timer))
  }

  private async initialize(): Promise<void> {
    await mkdir(this.subscriptionsPath, { recursive: true })

    let startingUp = true
    const startupPromises: Promise<void>[] = []

    this.subscriptionsWatcher = chokidar
      .watch(join(this.subscriptionsPath, '*.json'))
      .on('add', (path) => {
        const promise = this.onSubscriberChanged(path)
        this.watchPromise(promise)

        if (startingUp) {
          // Don't record the promise once we've started up because that
          // would cause a memory leak
          startupPromises.push(promise)
        }
      })
      .on('change', (path) => this.watchPromise(this.onSubscriberChanged(path)))
      .on('unlink', (path) => this.onSubscriberRemoved(path))

    await waitForReady(this.subscriptionsWatcher)

    // We receive the ready event as soon as chokidar has informed us of
    // all the subscription files, however we still need time to process them
    // If we mark ourselves as ready before we've done so, we may lose messages
    startingUp = false
    await Promise.all(startupPromises)
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

    // A file not found error means the queue has been deleted, so we no
    // longer need to store a message there
    await ignoreFileNotFoundErrors(atomicWriteFile(path, contents))

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
    const fileContents = await ignoreFileNotFoundErrors(readFile(path))

    if (!fileContents) {
      // It's possible the file no longer exists
      return
    }

    const externalSubscriber: ExternalSubscriber = JSON.parse(
      fileContents.toString()
    )

    await this.updateSubscriber(externalSubscriber)
    this.scheduleQueueRecheck(path)
  }

  private async updateSubscriber(
    externalSubscriber: ExternalSubscriber
  ): Promise<void> {
    if (
      JSON.stringify(externalSubscriber) !==
      JSON.stringify(this.externalSubscribers[externalSubscriber.queueName])
    ) {
      await this.createQueuePaths(externalSubscriber.queueName)
      this.externalSubscribers[externalSubscriber.queueName] =
        externalSubscriber

      debug(`Subscriber for queue ${externalSubscriber.queueName} changed`)
    }
  }

  private scheduleQueueRecheck(path: string) {
    // If the file changes several times in rapid succession, we may
    // not receive notifications for the subsequent updates, so check
    // back in a second to ensure our in-memory copy isn't stale
    const timer = setTimeout(() => {
      this.timers.splice(this.timers.indexOf(timer), 1)
      this.watchPromise(this.onSubscriberChanged(path))
    }, 1000)

    this.timers.push(timer)
  }

  private onSubscriberRemoved(path: string) {
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

  private watchPromise<T>(promise: Promise<T>) {
    promise.catch((e) => this.emit('error', e))
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

function randomString(): string {
  return String(Math.random()).substring(2)
}
