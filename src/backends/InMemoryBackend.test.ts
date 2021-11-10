import { Deferred } from 'ts-deferred'
import { BackendSubscriber, Message } from '../types'
import { createMessage, getCompleteMessage, getConcurrency } from '../util'
import { InMemoryBackend } from './InMemoryBackend'

describe('In memory backend', () => {
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

    const inMemory = new InMemoryBackend()
    inMemory.subscribe(subscriber)
    await inMemory.publish(message)

    expect(await dfd.promise).toMatchObject(message)
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
      let receivedMessage = false
      const subscriber: BackendSubscriber = {
        queueName: 'test',
        topics: [selector],
        handle: () => {
          receivedMessage = true
        }
      }
      const message = getCompleteMessage({
        topic,
        body: Buffer.from('hi there')
      })

      const inMemory = new InMemoryBackend()
      inMemory.subscribe(subscriber)
      await inMemory.publish(message)

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
        expect(numRunning).toBeLessThan(getConcurrency(subscriber))
        numRunning++
        maxRunning = Math.max(maxRunning, numRunning)

        await new Promise((resolve) => setTimeout(resolve, 100))
        numRunning--
        dfds[+body.toString()].resolve()
      },
      options: { concurrency: 2 }
    }
    const message = createMessage('foo', null)
    const inMemory = new InMemoryBackend()
    await inMemory.subscribe(subscriber)

    dfds.forEach((_, seq) =>
      inMemory.publish(
        getCompleteMessage({ ...message, body: Buffer.from(String(seq)) })
      )
    )
    await done

    expect(maxRunning).toBe(subscriber.options?.concurrency)
  })

  it('Multiple consumers with the same name should all receive messages', async () => {
    const dfds = [new Deferred(), new Deferred(), new Deferred()]
    const subscribers = dfds.map((_, idx) => createSubscriber(idx))
    const messagesReceivedBySubscriberId = subscribers.map(() => 0)
    const messagesReceivedByMessageId: number[] = []
    const done = Promise.all(dfds.map(({ promise }) => promise))

    const inMemory = new InMemoryBackend()

    await Promise.all(
      subscribers.map((subscriber) => inMemory.subscribe(subscriber))
    )

    for (let i = 0; i < subscribers.length; i++) {
      messagesReceivedByMessageId[i] = 0
      await inMemory.publish(
        getCompleteMessage(createMessage('foo', Buffer.from(String(i))))
      )
    }

    await done

    expect(messagesReceivedBySubscriberId.every((count) => count > 0))
    expect(messagesReceivedByMessageId.every((count) => count <= 1))

    function createSubscriber(subscriberId: number): BackendSubscriber {
      return {
        queueName: 'test',
        topics: ['foo'],
        handle({ body }) {
          const messageId = +body.toString()
          messagesReceivedByMessageId[messageId]++
          messagesReceivedBySubscriberId[subscriberId]++
          dfds[subscriberId].resolve()

          return new Promise(() => {})
        }
      }
    }
  })
})
