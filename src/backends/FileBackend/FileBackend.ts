import assert from 'assert'
import chokidar, { FSWatcher } from 'chokidar'
import createDebug from 'debug'
import { EventEmitter } from 'events'
import {
  close as closeCb,
  open as openCb,
  readFile as readFileCb,
  rename as renameCb,
  unlink as unlinkCb
} from 'fs'
import { join, resolve, sep } from 'path'
import PromiseQueue from 'promise-queue'
import { prop, uniq } from 'rambda'
import rimrafCb from 'rimraf'
import { clearInterval } from 'timers'
import { promisify } from 'util'
import {
  deadLetterQueue,
  disallowMultipleQueueSubscriptions
} from '../../polyfills'
import {
  Backend,
  BackendSubscriber,
  CanBindQueue,
  Message,
  Middleware
} from '../../types'
import { getConcurrency } from '../../util'
import {
  KEEPALIVE_INTERVAL,
  PROCESSING_DIRECTORY,
  QUEUES_DIRECTORY,
  READY_DIRECTORY,
  SUBSCRIPTIONS_DIRECTORY
} from './constants'
import { MessageRouter } from './MessageRouter'
import { ExternalSubscriber } from './types'
import {
  atomicWriteFile,
  deserializeMessage,
  getQueueNameFromMessagePath,
  getQueuePath,
  getSubscriptionPath,
  ignoreFileNotFoundErrors,
  isFileNotFoundError,
  waitForReady
} from './util'
import { Watchdog } from './Watchdog'

const debug = createDebug('announce:FileBackend')
const close = promisify(closeCb)
const open = promisify(openCb)
const readFile = promisify(readFileCb)
const rename = promisify(renameCb)
const rimraf = promisify(rimrafCb)
const unlink = promisify(unlinkCb)

/**
 * A backend that's backed by the filesystem to ensure at-least-once delivery.
 * It is designed for use with local file systems only - using a network drive
 * is not supported because the operating systemn doesn't always provide
 * notification that files have changed. In environments where there are
 * multiple instances of the application running across a network, it is
 * strongly recommended you use a dedicated message broker such as RabbitMQ
 * instead
 *
 * Supports:
 *  - guaranteed delivery
 *  - dead letter queues
 */
export class FileBackend extends EventEmitter implements Backend, CanBindQueue {
  public readonly ready: Promise<void>
  private readonly queuesPath: string
  private readonly subscriptionsPath: string
  private readonly queuesByName: Record<string, Queue> = {}
  private readonly messageRouter: MessageRouter
  private readonly watchdog: Watchdog

  static accepts(url: string) {
    return url.startsWith('file://')
  }

  constructor(url: string) {
    super()

    const basePath = url.replace('file://', '')
    this.queuesPath = resolve(basePath, QUEUES_DIRECTORY)
    this.subscriptionsPath = resolve(basePath, SUBSCRIPTIONS_DIRECTORY)
    this.watchdog = new Watchdog()
    this.messageRouter = new MessageRouter(basePath)

    this.ready = this.initialize()
    this.ready.then(
      () => {
        debug(`Backend ready: ${basePath}`)
      },
      (e) => {
        debug(`Startup failed: ${e}`)
        this.emit('error', e)
      }
    )
  }

  async subscribe(subscriber: BackendSubscriber): Promise<void> {
    const queueName = subscriber.queueName
    const queuePath = getQueuePath(this.queuesPath, queueName)

    await this.ready
    await this.bindQueue(queueName, subscriber.topics)
    await this.watchdog.watch(queuePath)

    const existingQueue = this.queuesByName[queueName]
    if (existingQueue) {
      await existingQueue.watcher.close()
    }

    const messagesGlob = join(queuePath, READY_DIRECTORY, '*.json')
    const watcher = chokidar
      .watch(messagesGlob)
      .on('add', (path) => this.onMessageAdded(path))
      .on('unlink', (path) => this.onMessageUnlinked(path))

    this.queuesByName[queueName] = {
      name: queueName,
      subscriber,
      watcher,
      pendingMessages: [],
      processingQueue: new PromiseQueue(getConcurrency(subscriber))
    }

    debug(
      `Registered subscriber ${JSON.stringify(
        subscriber
      )}, watching for messages in ${messagesGlob}`
    )
    await waitForReady(watcher)
  }

  async publish(message: Message<Buffer>): Promise<void> {
    await this.messageRouter.publish(message)

    debug(`Published message ${message.properties.id}`)
  }

  async destroyQueue(queueName: string): Promise<void> {
    const queue = this.queuesByName[queueName]

    if (queue) {
      await queue.watcher.close()
      this.watchdog.unwatch(getQueuePath(this.queuesPath, queueName))
      delete this.queuesByName[queueName]
    }

    await ignoreFileNotFoundErrors(
      unlink(getSubscriptionPath(this.subscriptionsPath, queueName))
    )
    await ignoreFileNotFoundErrors(
      rimraf(getQueuePath(this.queuesPath, queueName))
    )
  }

  async close(): Promise<void> {
    this.watchdog.close()
    await this.messageRouter.close()

    await this.ready.catch(() => {
      // Squelch - we need to clean up even if this fails
    })

    const watchers = Object.values(this.queuesByName).map(prop('watcher'))
    await Promise.all(watchers.map((watcher) => watcher.close()))

    debug('Closed')
  }

  /**
   * Binds the queue to the given topics, in addition to any topics it's
   * already listening on
   */
  async bindQueue(queueName: string, topics: readonly string[]): Promise<void> {
    await this.updateTopics(queueName, topics, [])
  }

  async unbindQueue(
    queueName: string,
    topics: readonly string[]
  ): Promise<void> {
    await this.updateTopics(queueName, [], topics)
  }

  getPolyfills(): Middleware[] {
    return [disallowMultipleQueueSubscriptions(), deadLetterQueue(this)]
  }

  private async initialize(): Promise<void> {
    this.watchdog.on('error', (e) => this.emit('error', e))
    this.messageRouter.on('error', (e) => this.emit('error', e))
    this.on('error', () => this.close())

    await this.messageRouter.ready
  }

  private async loadExternalSubscriber(
    queueName: string
  ): Promise<ExternalSubscriber> {
    const subscriberPath = getSubscriptionPath(
      this.subscriptionsPath,
      queueName
    )
    const existingContents = await ignoreFileNotFoundErrors(
      readFile(subscriberPath)
    )
    return existingContents
      ? JSON.parse(existingContents.toString())
      : { queueName, topics: [] }
  }

  private async updateTopics(
    queueName: string,
    topicsToAdd: readonly string[],
    topicsToRemove: readonly string[]
  ): Promise<void> {
    const subscriber = await this.loadExternalSubscriber(queueName)
    const existingTopics = subscriber.topics
    const updatedTopics = uniq(
      [...existingTopics, ...topicsToAdd].filter(
        (topic) => !topicsToRemove.includes(topic)
      )
    ).sort()

    if (JSON.stringify(existingTopics) !== JSON.stringify(updatedTopics)) {
      const subscriberPath = getSubscriptionPath(
        this.subscriptionsPath,
        queueName
      )
      subscriber.topics = updatedTopics

      await atomicWriteFile(subscriberPath, JSON.stringify(subscriber))
      await this.messageRouter.subscriberChanged(subscriberPath)

      debug(
        `Updated topic bindings for queue ${queueName} from ${JSON.stringify(
          existingTopics
        )} to ${JSON.stringify(updatedTopics)}`
      )
    }
  }

  private async onMessageAdded(path: string): Promise<void> {
    const queueName = getQueueNameFromMessagePath(path)
    const queue = this.queuesByName[queueName]

    if (queue) {
      debug(`Message queued: ${path}`)
      queue.pendingMessages.push(path)
      await this.processNextMessage(queueName)
    }
  }

  private processNextMessage(queueName: string) {
    const queue = this.queuesByName[queueName] as Queue | undefined

    if (
      !queue ||
      !queue.pendingMessages.length ||
      queue.processingQueue.getQueueLength() >= getConcurrency(queue.subscriber)
    ) {
      return
    }

    const messagePath = queue.pendingMessages.shift()
    assert(messagePath)

    queue.processingQueue
      .add(() => this.lockAndProcessMessage(queue, messagePath))
      .then(
        () => this.processNextMessage(queueName),
        (e) => this.emit('error', e)
      )
  }

  private async lockAndProcessMessage(
    queue: Queue,
    messagePath: string
  ): Promise<void> {
    const processingPath = await this.lockMessage(messagePath)
    if (!processingPath) {
      return
    }
    const keepaliveTimer = setInterval(() => {
      this.watchPromise(touch(processingPath))
    }, KEEPALIVE_INTERVAL)

    try {
      debug(`Processing message ${messagePath}`)
      await this.processMessage(queue, processingPath)
    } finally {
      clearInterval(keepaliveTimer)
      this.watchPromise(ignoreFileNotFoundErrors(unlink(processingPath)))
    }
    debug(`Message processed: ${messagePath}`)
  }

  private async lockMessage(messagePath: string): Promise<string | undefined> {
    const processingPath = getProcessingPath(messagePath)

    try {
      // Attempt to "lock" the file
      await rename(messagePath, processingPath)

      return processingPath
    } catch (e: unknown) {
      if (isFileNotFoundError(e)) {
        // Some other process has already locked this message
        return
      } else {
        throw e
      }
    }
  }

  private async processMessage(
    queue: Queue,
    processingPath: string
  ): Promise<void> {
    const message = await this.loadMessage(processingPath)
    const subscriber = queue.subscriber

    try {
      await subscriber.handle(message)
    } catch (e) {
      // The deadLetterQueue polyfill provides dead letter support, so
      // normally we will never reach this point
      debug(`Message ${message.properties.id} was rejected`)
    }
  }

  /**
   * Loads a persisted message from disk
   */
  private async loadMessage(path: string): Promise<Message<Buffer>> {
    return deserializeMessage(await readFile(path))
  }

  private async onMessageUnlinked(path: string): Promise<void> {
    const queueName = getQueueNameFromMessagePath(path)
    const queue = this.queuesByName[queueName]

    if (!queue) {
      return
    }

    const unprocessedPaths = queue.pendingMessages

    for (let idx = unprocessedPaths.length - 1; idx >= 0; idx--) {
      if (unprocessedPaths[idx] === path) {
        unprocessedPaths.splice(idx, 1)
      }
    }
    debug(`Message removed: ${path}`)
  }

  private watchPromise(promise: Promise<unknown>) {
    promise.catch((e) => this.emit('error', e))
  }
}

async function touch(path: string): Promise<void> {
  await close(await open(path, 'w'))
}

function getProcessingPath(readyPath: string): string {
  const pathParts = readyPath.split(sep)

  pathParts[pathParts.length - 2] = PROCESSING_DIRECTORY

  return pathParts.join(sep)
}

interface Queue {
  name: string
  subscriber: BackendSubscriber
  watcher: FSWatcher
  pendingMessages: string[]
  processingQueue: PromiseQueue
}
