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
import { prop } from 'rambda'
import rimrafCb from 'rimraf'
import { clearInterval } from 'timers'
import { promisify } from 'util'
import { BackendSubscriber, Message } from '../../types'
import {
  getConcurrency,
  getDeadLetterTopic,
  hasDeadLetterTopic
} from '../../util'
import {
  KEEPALIVE_INTERVAL,
  PROCESSING_DIRECTORY,
  QUEUES_DIRECTORY,
  READY_DIRECTORY,
  SUBSCRIPTIONS_DIRECTORY
} from './constants'
import { MessageRouter } from './MessageRouter'
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
export class FileBackend extends EventEmitter {
  public readonly ready: Promise<void>
  private readonly queuesPath: string
  private readonly subscriptionsPath: string
  private readonly queuesByName: Record<string, Queue> = {}
  private readonly messageRouter: MessageRouter
  private readonly watchdog: Watchdog

  static accepts(url: string) {
    return url.startsWith('file://')
  }

  constructor(basePath: string) {
    super()

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
    await this.writeSubscriber(subscriber)
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

    await waitForReady(watcher)
    debug(`Watching for messages in ${messagesGlob}`)
  }

  async publish(message: Message<Buffer>): Promise<void> {
    await this.messageRouter.publish(message)

    debug(`Published message ${message.properties.id}`)
  }

  async deleteQueue(queueName: string): Promise<void> {
    const queue = this.queuesByName[queueName]

    if (queue) {
      await queue.watcher.close()
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
    await this.ready
    await this.watchdog.close()
    await this.messageRouter.close()
    const watchers = Object.values(this.queuesByName).map(prop('watcher'))

    await Promise.all(watchers.map((watcher) => watcher.close()))

    debug('Closed')
  }

  private async initialize(): Promise<void> {
    await this.messageRouter.ready
  }

  private async writeSubscriber(subscriber: BackendSubscriber): Promise<void> {
    const subscriberPath = getSubscriptionPath(
      this.subscriptionsPath,
      subscriber.queueName
    )

    await atomicWriteFile(subscriberPath, serializeSubscriber(subscriber))
    await this.messageRouter.subscriberChanged(subscriberPath)

    debug(`Registered subscriber ${JSON.stringify(subscriber)}`)
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

  private async processNextMessage(queueName: string): Promise<void> {
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

    const processingPath = getProcessingPath(messagePath)

    queue.processingQueue
      .add(async () => {
        try {
          // Attempt to "lock" the file
          await rename(messagePath, processingPath)
        } catch (e: unknown) {
          if (isFileNotFoundError(e)) {
            // Some other process has already locked this message
            return
          } else {
            throw e
          }
        }

        debug(`Processing message ${messagePath}`)
        await this.processMessage(queue, processingPath)
        debug(`Message processed: ${messagePath}`)
      })
      .finally(() => this.processNextMessage(queueName))
  }

  private async processMessage(
    queue: Queue,
    messagePath: string
  ): Promise<void> {
    const keepaliveTimer = setInterval(async () => {
      // TODO: unhandled promise
      await touch(messagePath)
    }, KEEPALIVE_INTERVAL)

    try {
      const message = await this.loadMessage(messagePath)
      const subscriber = queue.subscriber

      try {
        await subscriber.handle(message)
      } catch (e) {
        if (hasDeadLetterTopic(subscriber)) {
          const deadLetterTopic = getDeadLetterTopic(subscriber)
          assert(deadLetterTopic)

          // TODO: Publish to DLQ/DLT
        }
      }
    } finally {
      await unlink(messagePath)
      clearInterval(keepaliveTimer)
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
}

function serializeSubscriber({ queueName, topics }: BackendSubscriber): string {
  return JSON.stringify({ queueName, topics })
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
