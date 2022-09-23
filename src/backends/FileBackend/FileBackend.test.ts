import assert from 'assert'
import { createHash } from 'crypto'
import { EventEmitter } from 'events'
import {
  chmod as chmodCb,
  readdir as readdirCb,
  stat as statCb,
  utimes as utimesCb,
  writeFile as writeFileCb
} from 'fs'
import { glob as globCb } from 'glob'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import rimrafCb from 'rimraf'
import { Deferred } from 'ts-deferred'
import { promisify } from 'util'
import { BackendSubscriber, Message } from '../../types'
import { getCompleteMessage } from '../../util'
import {
  PROCESSING_DIRECTORY,
  QUEUES_DIRECTORY,
  SUBSCRIPTIONS_DIRECTORY
} from './constants'
import { FileBackend } from './FileBackend'
import runOnlyPendingTimers = jest.runOnlyPendingTimers

const chmod = promisify(chmodCb)
const glob = promisify(globCb)
const readdir = promisify(readdirCb)
const rimraf = promisify(rimrafCb)
const stat = promisify(statCb)
const writeFile = promisify(writeFileCb)
const utimes = promisify(utimesCb)

const READ_ONLY = 0o500
const ALL_PERMS = 0o700

describe('File backend', () => {
  const hash = createHash('md5').update(__filename).digest('hex').toString()
  const basePath = resolve(tmpdir(), hash)
  let handles: (() => unknown)[]
  let fileBackend: FileBackend

  beforeEach(async () => {
    // Some tests set read-only permissions, so we need to clear that
    // before attempting to delete the files
    const existingFiles = await glob(resolve(basePath, '**'))
    await Promise.all(existingFiles.map((path) => chmod(path, ALL_PERMS)))
    await rimraf(basePath)
    fileBackend = new FileBackend(basePath)
    await fileBackend.ready
    handles = []
  })

  afterEach(async () => {
    jest.useRealTimers()
    await fileBackend.close()
    await Promise.all(handles.map((handle) => handle()))
  })

  it('Should not redeliver messages that were successfully processed', async () => {
    const dfd = new Deferred()
    let handleCount = 0
    const subscriber: BackendSubscriber = {
      queueName: 'test',
      topics: ['foo.bar'],
      handle: () => {
        handleCount++
        dfd.resolve()
      }
    }
    const message = getCompleteMessage({
      topic: 'foo.bar',
      body: Buffer.from('hi there')
    })

    const fileBackend1 = new FileBackend(basePath)
    handles.push(() => fileBackend1.close())
    await fileBackend1.subscribe(subscriber)
    await fileBackend1.publish(message)
    await dfd.promise

    const fileBackend2 = new FileBackend(basePath)
    handles.push(() => fileBackend2.close())
    await fileBackend2.subscribe(subscriber)

    expect(handleCount).toBe(1)
  })

  it('should handle rebinding queues', async () => {
    const emitter = new EventEmitter()
    const testSubscription1: BackendSubscriber = {
      queueName: 'test',
      topics: ['test1'],
      handle({ topic }: Message) {
        emitter.emit(topic)
      }
    }
    const interval = setInterval(async () => {
      await fileBackend.publish(
        getCompleteMessage({
          topic: 'test1',
          body: Buffer.from('hi there'),
          properties: { id: `${Date.now()}-test1` }
        })
      )
      await fileBackend.publish(
        getCompleteMessage({
          topic: 'test2',
          body: Buffer.from('hi there'),
          properties: { id: `${Date.now()}-test2` }
        })
      )
    }, 50)
    await fileBackend.subscribe(testSubscription1)
    const fileBackend2 = new FileBackend(basePath)
    handles.push(
      () => fileBackend2.close(),
      () => clearInterval(interval)
    )

    // Wait until we see a message come through
    await new Promise((resolve) => emitter.once('test1', resolve))

    // This should stop (after a while) the messages from topic 1
    await fileBackend2.unbindQueue('test', ['test1'])
    await fileBackend2.bindQueue('test', ['test2'])

    // Wait until we see a message come through
    await new Promise((resolve) => emitter.once('test2', resolve))

    const messagesSeen: Record<string, number> = { test1: 0, test2: 0 }
    emitter.on('test1', () => messagesSeen.test1++)
    emitter.on('test2', () => messagesSeen.test2++)

    // Wait until we've seen a few messages into test2
    await new Promise<void>((resolve) =>
      emitter.on('test2', () => {
        if (messagesSeen.test2 >= 3) {
          resolve()
        }
      })
    )

    // Depending on exactly when the first FileBackend gets notified that the
    // subscription has changed, there may still be a message dispatched
    // to test1, but there should not be more than one message
    expect(messagesSeen.test1).not.toBeGreaterThan(1)
  })

  it('should emit errors received from the watchdog', async () => {
    const error = new Error('Oh no')
    const deferred = new Deferred()
    fileBackend.on('error', (e) => deferred.resolve(e))

    fileBackend['watchdog'].emit('error', error)

    expect(await deferred.promise).toBe(error)
  })

  it('should emit errors received from the message router', async () => {
    const error = new Error('Oh no')
    const deferred = new Deferred()
    fileBackend.on('error', (e) => deferred.resolve(e))

    fileBackend['messageRouter'].emit('error', error)

    expect(await deferred.promise).toBe(error)
  })

  it('should emit an error if startup fails', async () => {
    await fileBackend.close()

    const deferred = new Deferred()
    await writeFile(
      resolve(basePath, SUBSCRIPTIONS_DIRECTORY, 'test.json'),
      'invalid JSON'
    )
    fileBackend = new FileBackend(basePath)
    fileBackend.on('error', (error) => deferred.resolve(error))

    expect(await deferred.promise).toBeInstanceOf(Error)
  })

  it("should touch the messages it's processing to stop the watchdog from restoring them", async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] })
    await fileBackend.close()
    fileBackend = new FileBackend(basePath)

    const processingDeferred = new Deferred()
    const subscriber: BackendSubscriber = {
      queueName: 'touchtest',
      topics: ['test'],
      handle() {
        return new Promise(() => {
          processingDeferred.resolve()
          // Never resolve
        })
      }
    }
    await fileBackend.subscribe(subscriber)
    await fileBackend.publish(
      getCompleteMessage({ topic: 'test', body: Buffer.from('hi there') })
    )
    await processingDeferred.promise

    const processingPath = resolve(
      basePath,
      QUEUES_DIRECTORY,
      subscriber.queueName,
      PROCESSING_DIRECTORY
    )
    const messageFile = await getFirstFile(processingPath)
    await utimes(messageFile, new Date('2020-01-01'), new Date('2020-01-01'))

    runOnlyPendingTimers()

    const stats = await stat(messageFile)
    expect(stats.mtimeMs).toBeGreaterThan(Date.now() / 1000 - 1)
  })

  it('should correctly replace subscribers', async () => {
    const messageTopics: string[] = []
    const messagesDeferred = new Deferred()
    const subscriber1: BackendSubscriber = {
      queueName: 'replacementtest',
      topics: ['test1'],
      handle(message) {
        messageTopics.push(message.topic)

        if (messageTopics.length === 2) {
          messagesDeferred.resolve()
        }
      }
    }
    const subscriber2: BackendSubscriber = {
      ...subscriber1,
      topics: ['test2']
    }
    // Topics are cumulative unless explicitly unbound, so we should
    // receive both messages
    const message1: Message<Buffer> = getCompleteMessage({
      topic: 'test1',
      body: Buffer.from('hi there')
    })
    const message2: Message<Buffer> = { ...message1, topic: 'test2' }

    await fileBackend.subscribe(subscriber1)
    await fileBackend.subscribe(subscriber2)
    await fileBackend.publish(message1)
    await fileBackend.publish(message2)

    await messagesDeferred.promise

    expect(messageTopics.sort()).toEqual(['test1', 'test2'])
  })

  it('should ignore notifications about queues that have been removed', async () => {
    await fileBackend['onMessageAdded']('non-existent-queue')
  })

  it('should emit an error if locking a message fails', async () => {
    await fileBackend.bindQueue('test-locking', ['test'])
    await fileBackend.publish(
      getCompleteMessage({ topic: 'test', body: Buffer.from('hi there') })
    )

    await chmod(
      join(basePath, QUEUES_DIRECTORY, 'test-locking', PROCESSING_DIRECTORY),
      READ_ONLY
    )

    const errorDeferred = new Deferred()
    fileBackend.on('error', (error) => errorDeferred.resolve(error))

    await fileBackend.subscribe({
      queueName: 'test-locking',
      topics: ['test'],
      handle: () => {
        console.log('fdsaf')
        // Do nothing
      }
    })

    expect(await errorDeferred.promise).toMatchObject({ code: 'EACCES' })
  })

  it('should emit an error if there is a problem removing the processing file', async () => {
    const processingDeferred = new Deferred()
    const setPermissionsDeferred = new Deferred()
    const errorDeferred = new Deferred()
    fileBackend.on('error', (error) => errorDeferred.resolve(error))
    await fileBackend.subscribe({
      queueName: 'test-processing',
      topics: ['test'],
      handle: async () => {
        processingDeferred.resolve()
        await setPermissionsDeferred.promise
      }
    })
    await fileBackend.publish(
      getCompleteMessage({ topic: 'test', body: Buffer.from('hi there') })
    )

    await processingDeferred.promise
    await chmod(
      join(basePath, QUEUES_DIRECTORY, 'test-processing', PROCESSING_DIRECTORY),
      READ_ONLY
    )
    setPermissionsDeferred.resolve()

    expect(await errorDeferred.promise).toMatchObject({ code: 'EACCES' })
  })

  it('should ignore notifications about messages being removed from queues that no longer have subscribers', async () => {
    await fileBackend['onMessageUnlinked']('non-existent-queue')
  })

  it("should ignore attempts to destroy queues that don't exist", async () => {
    await fileBackend.destroyQueue('non-existent-queue')
  })

  async function getFirstFile(path: string): Promise<string> {
    const files = await readdir(path)
    assert(files.length === 1)

    return join(path, files[0])
  }
})
