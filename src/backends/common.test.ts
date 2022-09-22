import { createHash } from 'crypto'
import { config } from 'dotenv-flow'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { Deferred } from 'ts-deferred'
import { Announce } from '../Announce'
import { BackendSubscriber, Message } from '../types'
import { createMessage, getCompleteMessage, getConcurrency } from '../util'

config({ silent: true, purge_dotenv: true })

const hash = createHash('md5').update(__filename).digest('hex').toString()
const basePath = resolve(tmpdir(), hash)

xdescribe.each([
  ['InMemory', 'memory://'],
  ['File', `file://${basePath}`],
  ['RabbitMQ', process.env.RABBITMQ_URL ?? '']
])('Common backend tests: %p', (_, url) => {
  let announce: Announce

  beforeEach(async () => {
    announce = new Announce({ url })
  })

  afterEach(async () => {
    await announce.close()
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

    await announce.subscribe(subscriber)
    await announce.publish(message)

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

      await announce.subscribe(subscriber)
      await announce.publish(message)

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
    await announce.subscribe(subscriber)

    await Promise.all(
      dfds.map((_, seq) => {
        return announce.publish(
          getCompleteMessage({ ...message, body: Buffer.from(String(seq)) })
        )
      })
    )
    await done

    expect(maxRunning).toBe(subscriber.options?.concurrency)
  })
})
