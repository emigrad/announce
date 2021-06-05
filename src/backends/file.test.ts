import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { Deferred } from 'ts-deferred'
import { promisify } from 'util'
import { Message, Subscriber, SubscriberExtra } from '../types'
import { FileBackend } from './file'
import rimrafCb from 'rimraf'

const rimraf = promisify(rimrafCb)

describe('File backend', () => {
  const hash = createHash('md5').update(__filename).digest('hex').toString()
  const path = resolve(tmpdir(), hash)

  beforeEach(async () => {
    await rimraf(path)
  })

  it('Should publish and receive messages', async () => {
    const dfd = new Deferred<[any, SubscriberExtra]>()
    const subscriber: Subscriber<{}> = {
      name: 'test',
      topics: ['foo.bar'],
      handle: (message, extra) => dfd.resolve([message, extra])
    }
    const message: Message<{}> = {
      headers: { id: 'abcd', published: new Date().toISOString() },
      topic: 'foo.bar',
      body: { hello: 'world' }
    }

    const fileBackend = new FileBackend(path)
    await fileBackend.subscribe(subscriber)
    await fileBackend.publish(message)

    const [receivedBody, extra] = await dfd.promise
    expect(receivedBody).toBe(message.body)
    expect(extra).toMatchObject({
      headers: message.headers,
      topic: message.topic
    })
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
      const subscriber: Subscriber<{}> = {
        name: 'test',
        topics: [selector],
        handle: () => (receivedMessage = true)
      }
      const message: Message<{}> = {
        headers: { id: 'abcd', published: new Date().toISOString() },
        topic,
        body: { hello: 'world' }
      }

      const fileBackend = new FileBackend(path)
      fileBackend.subscribe(subscriber)
      await fileBackend.publish(message)

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

    const subscriber: Subscriber<{ seq: number }> = {
      name: 'test',
      topics: ['foo'],
      handle: async (body) => {
        expect(numRunning).toBeLessThan(subscriber.options?.concurrency!)
        numRunning++
        maxRunning = Math.max(maxRunning, numRunning)

        await new Promise((resolve) => setTimeout(resolve, 100))
        numRunning--
        dfds[body.seq].resolve()
      },
      options: { concurrency: 2 }
    }
    const message: Omit<Message<{}>, 'body'> = {
      headers: { id: 'abcd', published: new Date().toISOString() },
      topic: 'foo'
    }
    const fileBackend = new FileBackend(path)
    fileBackend.subscribe(subscriber)

    dfds.forEach((_, seq) => fileBackend.publish({ ...message, body: { seq } }))
    await done

    expect(maxRunning).toBe(subscriber.options?.concurrency)
  })
})
