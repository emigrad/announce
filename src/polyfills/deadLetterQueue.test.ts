import { Announce } from '../Announce'
import { BackendSubscriber } from '../types'
import { getCompleteMessage } from '../util'

describe('deadLetterQueue polyfill', () => {
  let announce: Announce

  beforeEach(() => {
    // The InMemoryBackend uses the polyfill
    announce = new Announce({ url: 'memory://' })
  })

  it("should 'absorb' rejections if the subscriber has no DLQ", async () => {
    let backendSubscriber!: BackendSubscriber
    announce['backend'].subscribe = async (subscriber) => {
      backendSubscriber = subscriber
    }
    await announce.subscribe({
      queueName: 'test',
      topics: ['test'],
      handle: () => {
        throw new Error()
      },
      options: { preserveRejectedMessages: false }
    })

    // If the polyfill doesn't handle the rejection, this will fail
    await backendSubscriber.handle(
      getCompleteMessage({ topic: 'test', body: Buffer.from('') })
    )
  })
})
