import assert from 'assert'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { resolve } from 'path'
import rimrafCb from 'rimraf'
import { Deferred } from 'ts-deferred'
import { promisify } from 'util'
import { BackendSubscriber, Message } from '../types'
import {
  createMessage,
  getCompleteMessage,
  getConcurrency,
  getDeadLetterQueueName,
  getDeadLetterTopic
} from '../util'
import { FileBackend } from './FileBackend'

const rimraf = promisify(rimrafCb)

describe('File backend', () => {
  const hash = createHash('md5').update(__filename).digest('hex').toString()
  const path = resolve(tmpdir(), hash)
  let fileBackend: FileBackend

  beforeEach(async () => {
    await rimraf(path)
    fileBackend = new FileBackend(path)
  })

  afterEach(async () => {
    await fileBackend.close()
  })

  it('Should publish and receive messages', async () => {
    const dfd = new Deferred<Message<Buffer>>()
    const subscriber: BackendSubscriber = {
      queueName: 'test',
      topics: ['foo.bar'],
      handle: (message) => dfd.resolve(message)
    }
    const message = getCompleteMessage({
      topic: 'foo.bar',
      body: Buffer.from('hi there')
    })

    await fileBackend.subscribe(subscriber)
    await fileBackend.publish(message)

    const receivedMessage = await dfd.promise
    expect(receivedMessage).toMatchObject(message)
  })

  it.each([
    ['foo.*', 'foo.bar', true],
    ['foo.*', 'foo', false],
    ['foo.*', 'foo.bar.baz', false],
    ['foo.*.baz', 'foo.bar.baz', true],
    ['*.bar.baz', 'foo.bar.baz', true],
    ['*.foo.baz', 'foo.bar.baz', false],
    ['**', 'foo', true],
    ['**', 'foo.bar', true],
    ['**.baz', 'foo.bar', false],
    ['**.baz', 'foo.baz.bar', false],
    ['**.baz', 'foo.bar.baz', true],
    ['foo.**', 'foo', false],
    ['foo.**', 'foo.bar.baz', true]
  ])(
    'Should support wildcards in topic selectors (selector: %p, topic: %p)',
    async (selector, topic, expected) => {
      const delay = 200
      const deferred = new Deferred<boolean>()
      let receivedMessage = false
      const subscriber: BackendSubscriber = {
        queueName: 'test',
        topics: [selector],
        handle: () => {
          receivedMessage = true
          deferred.resolve(true)
          clearTimeout(timeout)
        }
      }
      const message = createMessage(topic, Buffer.from('hi there'))
      const timeout = setTimeout(() => deferred.resolve(false), delay)

      await fileBackend.subscribe(subscriber)
      await fileBackend.publish(getCompleteMessage(message))

      await deferred.promise

      expect(receivedMessage).toBe(expected)
    }
  )

  it('Should honour concurrency', async () => {
    let numRunning = 0
    let maxRunning = 0
    const dfds = [
      new Deferred(),
      new Deferred(),
      new Deferred(),
      new Deferred(),
      new Deferred(),
      new Deferred()
    ]
    const done = Promise.all(dfds.map(({ promise }) => promise))

    const subscriber: BackendSubscriber = {
      queueName: 'test',
      topics: ['foo'],
      handle: async ({ body }) => {
        numRunning++
        maxRunning = Math.max(maxRunning, numRunning)

        await new Promise((resolve) => setTimeout(resolve, 100))
        numRunning--
        dfds[+body.toString()].resolve()
      },
      options: { concurrency: 2 }
    }
    const message = createMessage('foo', null)
    await fileBackend.subscribe(subscriber)

    dfds.forEach((_, seq) =>
      fileBackend.publish(
        getCompleteMessage({ ...message, body: Buffer.from(String(seq)) })
      )
    )
    await done

    expect(maxRunning).toBe(getConcurrency(subscriber))
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

    const fileBackend1 = new FileBackend(path)
    await fileBackend1.subscribe(subscriber)
    await fileBackend1.publish(message)
    await dfd.promise

    const fileBackend2 = new FileBackend(path)
    await fileBackend2.subscribe(subscriber)

    expect(handleCount).toBe(1)
    await Promise.all([fileBackend1.close(), fileBackend2.close()])
  })

  it.each([false, true])(
    'Should send rejected messages to the dead letter queue (currently subscribed: %p)',
    async (currentlySubscribed) => {
      const subscriberDfd = new Deferred()
      const dlqSubscriberDfd = new Deferred()
      const subscriber: BackendSubscriber = {
        queueName: 'test',
        topics: ['foo.bar'],
        handle: () => {
          subscriberDfd.resolve()
          return Promise.reject()
        }
      }
      const dlqName = getDeadLetterQueueName(subscriber)
      const dlqTopic = getDeadLetterTopic(subscriber)
      assert(dlqName && dlqTopic)
      const dlqSubscriber: BackendSubscriber = {
        queueName: dlqName,
        topics: [dlqTopic],
        handle: () => dlqSubscriberDfd.resolve()
      }
      const message = getCompleteMessage({
        topic: 'foo.bar',
        body: Buffer.from('hi there')
      })

      await fileBackend.subscribe(subscriber)

      if (currentlySubscribed) {
        await fileBackend.subscribe(dlqSubscriber)
      }

      await fileBackend.publish(message)
      await subscriberDfd.promise

      if (!currentlySubscribed) {
        await fileBackend.subscribe(dlqSubscriber)
      }

      await subscriberDfd.promise
    }
  )

  it.todo('should support subscriber and publisher being on separate processes')
  it.todo('should recover crashed messages')
  it.todo('should not recover messages that are still being processed')
  it.todo('should handle redefining queues')
  it.todo('should handle queues being redefined by another process')
  it.todo('should handle queues being removed')
  it.todo('message processing stress test')
  it.todo('should handle messages that were added before startup')
})
