import { Deferred } from 'ts-deferred'
import { getCompleteMessage } from '../../util'
import { InMemoryBackend } from './InMemoryBackend'

describe('InMemoryBackend', () => {
  let backend: InMemoryBackend

  beforeEach(() => {
    backend = new InMemoryBackend()
  })

  it('should not emit an error if a handler fails', async () => {
    let numSeenMessages = 0
    let errorEmitted = false
    const messagesDfd = new Deferred()
    const message = getCompleteMessage({ topic: 'test', body: Buffer.from('') })
    await backend.subscribe({
      queueName: 'test',
      topics: ['test'],
      handle() {
        if (++numSeenMessages === 3) {
          messagesDfd.resolve()
        }

        throw new Error()
      }
    })
    backend.on('error', () => {
      errorEmitted = true
    })

    // If the failure of the first message hasn't handled properly, the
    // subsequent messages will fail to be processed
    await Promise.all([
      backend.publish(message),
      backend.publish(message),
      backend.publish(message)
    ])

    await messagesDfd.promise
    expect(errorEmitted).toBe(false)
  })

  it('should emit an error if any promises fail', async () => {
    const error = new Error('Oh no')
    const deferred = new Deferred()
    backend.on('error', (err) => deferred.resolve(err))
    backend['watchPromise'](Promise.reject(error))

    expect(await deferred.promise).toBe(error)
  })
})
