import { tmpdir } from 'os'
import { BackendConstructor } from '../types'
import { backendFactory } from './backendFactory'
import { FileBackend } from './FileBackend'
import { InMemoryBackend } from './InMemoryBackend'

describe('backendFactory', () => {
  it.each([
    [`file://${tmpdir()}`, FileBackend],
    ['memory://', InMemoryBackend],
    ['blah://', undefined]
  ])(
    'Should return the appropriate backend for the URL %p',
    (url: string, expectedClass: BackendConstructor | undefined) => {
      const backend = backendFactory()(url)

      if (expectedClass) {
        expect(backend).toBeInstanceOf(expectedClass)
      } else {
        expect(backend).toBeUndefined()
      }
    }
  )
})
