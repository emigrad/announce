import { tmpdir } from 'os'
import { Backend, BackendConstructor } from '../types'
import { BackendFactory } from './BackendFactory'
import { FileBackend } from './FileBackend'
import { InMemoryBackend } from './InMemoryBackend'

describe('BackendFactory', () => {
  let backend: Backend | undefined

  it.each([
    [`file://${tmpdir()}`, FileBackend],
    ['memory://', InMemoryBackend],
    ['blah://', undefined]
  ])(
    'Should return the appropriate backend for the URL %p',
    (url: string, expectedClass: BackendConstructor | undefined) => {
      const factory = new BackendFactory()
      backend = factory.getBackend(url)

      if (expectedClass) {
        expect(backend).toBeInstanceOf(expectedClass)
      } else {
        expect(backend).toBeUndefined()
      }
    }
  )
})
