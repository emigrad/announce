import assert from 'assert'
import chokidar, { FSWatcher } from 'chokidar'
import createDebug from 'debug'
import { EventEmitter } from 'events'
import {
  close as closeCb,
  mkdir as mkdirCb,
  open as openCb,
  readdir as readdirCb,
  readFile as readFileCb,
  rename as renameCb,
  stat as statCb,
  unlink as unlinkCb,
  writeFile as writeFileCb
} from 'fs'
import { basename, dirname, join, resolve } from 'path'
import PromiseQueue from 'promise-queue'
import { prop } from 'rambda'
import { promisify } from 'util'
import { BackendSubscriber, Message } from '../types'
import { getConcurrency, getDeadLetterTopic, hasDeadLetterTopic } from '../util'

const debug = createDebug('announce:FileBackend')

const close = promisify(closeCb)
const mkdir = promisify(mkdirCb)
const open = promisify(openCb)
const readdir = promisify(readdirCb)
const readFile = promisify(readFileCb)
const rename = promisify(renameCb)
const stat = promisify(statCb)
const unlink = promisify(unlinkCb)
const writeFile = promisify(writeFileCb)

const KEEPALIVE_INTERVAL = 30000

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
  private readonly queuePath: string
  private readonly subscriptionsPath: string
  private subscriptionsWatcher!: FSWatcher
  private readonly externalSubscribers: Record<string, ExternalSubscriber> = {}
  private readonly startupPromise: Promise<void>
  private readonly processingTimesByPath: Record<string, number> = {}
  private readonly queuesByName: Record<string, Queue> = {}

  static accepts(url: string) {
    return url.startsWith('file://')
  }

  constructor(path: string) {
    super()

    this.queuePath = resolve(path, 'queues')
    this.subscriptionsPath = resolve(path, 'subscriptions')

    this.startupPromise = this.startup()
    this.startupPromise.then(
      () => {
        debug(`Backend ready: ${path}`)
      },
      (e) => {
        debug(`Startup failed: ${e}`)
        this.emit('error', e)
      }
    )
  }

  async subscribe(subscriber: BackendSubscriber): Promise<void> {
    await this.startupPromise
    await this.writeSubscriber(subscriber)

    // Make sure the queue has been fully created before we proceed so that
    // there is a directory to watch
    await this.onSubscriberChanged(this.getSubscriberPath(subscriber))

    const queueName = subscriber.queueName
    const queuePath = this.getQueuePath(queueName)
    const existingQueue = this.queuesByName[queueName]
    if (existingQueue) {
      await existingQueue.watcher.close()
    }

    const watcher = chokidar
      .watch(queuePath, { atomic: false })
      .on('add', (path) => this.onMessageAdded(path))
      .on('change', (path) => this.onMessageTouched(path))
      .on('unlink', (path) => this.onMessageUnlinked(path))

    this.queuesByName[queueName] = {
      name: queueName,
      subscriber,
      watcher,
      pendingMessages: [],
      processingQueue: new PromiseQueue(getConcurrency(subscriber))
    }

    await this.loadExistingMessages(queueName)

    debug(`Watching for messages in ${queuePath}`)
  }

  async publish(message: Message<Buffer>): Promise<void> {
    await this.startupPromise
    const queueNames = Object.values(this.externalSubscribers)
      .filter(subscribesTo(message.topic))
      .map(prop('queueName'))

    await Promise.all(
      queueNames.map((queueName) =>
        this.addToPersistedQueue(message, queueName)
      )
    )

    debug(`Published message ${message.properties.id}`)
  }

  async close(): Promise<void> {
    await this.startupPromise
    const watchers = [
      this.subscriptionsWatcher,
      ...Object.values(this.queuesByName).map(prop('watcher'))
    ]

    await Promise.all(watchers.map((watcher) => watcher.close()))

    debug('Closed')
  }

  private async startup(): Promise<void> {
    await mkdir(this.subscriptionsPath, { recursive: true })

    this.subscriptionsWatcher = chokidar
      .watch(this.subscriptionsPath)
      .on('add', (path) => this.onSubscriberChanged(path))
      .on('change', (path) => this.onSubscriberChanged(path))
      .on('unlink', (path) => this.onSubscriberRemoved(path))

    await this.loadExternalSubscribers()

    // TODO: restore crashed messages. We need to check that the file actually
    // has some contents, so that we don't accidentally restore a deleted
    // file that was recreated by touch()
  }

  /**
   * Adds the message to the queue on disk
   */
  private async addToPersistedQueue(
    message: Message<Buffer>,
    queue: string
  ): Promise<void> {
    const path = this.getMessagePath(message, queue)
    const contents = JSON.stringify({
      ...message,
      body: message.body.toString('base64')
    })

    await writeFile(path, contents)
    debug(`Wrote message ${message.properties.id} to ${path}`)
  }

  private async writeSubscriber(subscriber: BackendSubscriber): Promise<void> {
    await writeFile(
      this.getSubscriberPath(subscriber),
      serializeSubscriber(subscriber)
    )

    debug(`Registered subscriber ${JSON.stringify(subscriber)}`)
  }

  private async onSubscriberChanged(path: string): Promise<void> {
    const fileContents = await readFile(path)
    let externalSubscriber: ExternalSubscriber

    try {
      externalSubscriber = deserializeSubscriber(fileContents.toString())
    } catch {
      // We can sometimes get incomplete details because we read the file
      // before it had finished writing. If that's the case, ignore the
      // subscriber and wait for the next update event
      return
    }

    await this.createQueuePath(externalSubscriber.queueName)
    this.externalSubscribers[externalSubscriber.queueName] = externalSubscriber

    debug(`Subscriber added or changed: ${path}`)
  }

  private async onSubscriberRemoved(path: string): Promise<void> {
    delete this.externalSubscribers[this.getQueueNameFromSubscriberPath(path)]

    debug(`Subscriber removed: ${path}`)
  }

  private async loadExternalSubscribers(): Promise<void> {
    const subscriptionFiles = await readdir(
      this.getQueuePath(this.subscriptionsPath)
    )

    await Promise.all(
      subscriptionFiles.map((path) =>
        this.onSubscriberChanged(join(this.subscriptionsPath, path))
      )
    )
  }

  private async onMessageAdded(path: string): Promise<void> {
    const filename = basename(path)
    const queueName = basename(dirname(path))

    if (filename.includes('.%processing.')) {
      await this.onMessageTouched(path)
    } else {
      debug(`Message added: ${path}`)
      this.queuesByName[queueName].pendingMessages.push(path)
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

    const processingPath = messagePath.replace(/\.json$/, '.%processing.json')

    queue.processingQueue
      .add(async () => {
        try {
          // Attempt to "lock" the file
          await rename(messagePath, processingPath)

          await this.processMessage(queue, processingPath)
        } catch (e: unknown) {
          if ((e as { code?: string })?.code !== 'ENOENT') {
            throw e
          }
        }
      })
      .finally(() => this.processNextMessage(queueName))
  }

  private async processMessage(
    queue: Queue,
    messagePath: string
  ): Promise<void> {
    const watchdog = setInterval(async () => {
      // TODO: unhandled promise
      await touch(messagePath)
    }, KEEPALIVE_INTERVAL / 5)

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
      clearInterval(watchdog)
    }
  }

  /**
   * Loads a persisted message from disk
   */
  private async loadMessage(path: string): Promise<Message<Buffer>> {
    const rawMessage = await readFile(path, 'utf8')

    const parsedMessage = JSON.parse(rawMessage) as Message<string>
    parsedMessage.properties.date = new Date(parsedMessage.properties.date)
    return { ...parsedMessage, body: Buffer.from(parsedMessage.body, 'base64') }
  }

  private async onMessageTouched(path: string): Promise<void> {
    const filename = basename(path)

    if (filename.includes('.%processing.')) {
      try {
        const stats = await stat(path)
        debug(`Processing flag updated: ${path}`)
        this.processingTimesByPath[path] = stats.ctimeMs
      } catch {
        // The file has already been removed so we no longer need to track it
      }
    }
  }

  private async onMessageUnlinked(path: string): Promise<void> {
    const filename = basename(path)
    const queueName = basename(dirname(path))
    const queue = this.queuesByName[queueName]

    if (!queue) {
      return
    } else if (filename.includes('.%processing.')) {
      delete this.processingTimesByPath[path]
      debug(`Processing flag removed: ${path}`)
    } else {
      const unprocessedPaths = queue.pendingMessages

      for (let idx = unprocessedPaths.length - 1; idx >= 0; idx--) {
        if (unprocessedPaths[idx] === path) {
          unprocessedPaths.splice(idx, 1)
        }
      }
      debug(`Message removed: ${path}`)
    }
  }

  private async loadExistingMessages(queueName: string): Promise<void> {
    const paths = await readdir(this.getQueuePath(queueName))

    paths.sort().forEach((path) => this.onMessageAdded(path))
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
  private getMessagePath(message: Message<Buffer>, queueName: string): string {
    return join(
      this.getQueuePath(queueName),
      `${encodeURIComponent(message.properties.id)}.json`
    )
  }

  private getQueueNameFromSubscriberPath(path: string): string {
    return decodeURIComponent(basename(path).replace(/\.json$/, ''))
  }

  private getSubscriberPath(subscriber: ExternalSubscriber) {
    return join(
      this.subscriptionsPath,
      `${encodeURIComponent(subscriber.queueName)}.json`
    )
  }
}

function serializeSubscriber({ queueName, topics }: BackendSubscriber): string {
  return JSON.stringify({ queueName, topics })
}

function deserializeSubscriber(str: string): ExternalSubscriber {
  return JSON.parse(str)
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

async function touch(path: string): Promise<void> {
  await close(await open(path, 'w'))
}

type ExternalSubscriber = Pick<BackendSubscriber, 'queueName' | 'topics'>

interface Queue {
  name: string
  subscriber: BackendSubscriber
  watcher: FSWatcher
  pendingMessages: string[]
  processingQueue: PromiseQueue
}
