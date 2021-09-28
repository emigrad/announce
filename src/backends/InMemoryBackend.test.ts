import { Deferred } from 'ts-deferred'
import { getConcurrency } from '../selectors'
import { BackendSubscriber, Message } from '../types'
import { InMemoryBackend } from './InMemoryBackend'

describe('In memory backend', () => {
  it('Should publish and receive messages', async () => {
    const dfd = new Deferred<Message<Buffer>>()
    const subscriber: BackendSubscriber = {
      name: 'test',
      topics: ['foo.bar'],
      handle: (message) => dfd.resolve(message)
    }
    const message: Message<Buffer> = {
      headers: { id: 'abcd', published: new Date().toISOString() },
      topic: 'foo.bar',
      body: Buffer.from('hi there')
    }

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
        name: 'test',
        topics: [selector],
        handle: () => {
          receivedMessage = true
        }
      }
      const message: Message<Buffer> = {
        headers: { id: 'abcd', published: new Date().toISOString() },
        topic,
        body: Buffer.from('hi there')
      }

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
      name: 'test',
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
    const message: Omit<Message<Buffer>, 'body'> = {
      headers: { id: 'abcd', published: new Date().toISOString() },
      topic: 'foo'
    }
    const inMemory = new InMemoryBackend()
    inMemory.subscribe(subscriber)

    dfds.forEach((_, seq) =>
      inMemory.publish({ ...message, body: Buffer.from(String(seq)) })
    )
    await done

    expect(maxRunning).toBe(subscriber.options?.concurrency)
  })
})
