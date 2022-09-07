import { BackendConstructor, BackendFactory } from '../types'
import { FileBackend } from './FileBackend'
import { InMemoryBackend } from './InMemoryBackend'
import { RabbitMQBackend } from './RabbitMQBackend'

export function backendFactory(
  constructors: readonly BackendConstructor[] = [
    FileBackend,
    InMemoryBackend,
    RabbitMQBackend
  ]
): BackendFactory {
  return (url) => {
    const constructorFunc = constructors.find((backendConstructor) =>
      backendConstructor.accepts(url)
    )

    return constructorFunc && new constructorFunc(url)
  }
}
