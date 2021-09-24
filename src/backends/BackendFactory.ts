import { Backend, BackendConstructor } from '../types'
import { FileBackend } from './FileBackend'
import { InMemoryBackend } from './InMemoryBackend'
import { RabbitMQBackend } from './RabbitMQBackend'

const defaultConstructors: BackendConstructor[] = [
  FileBackend,
  InMemoryBackend,
  RabbitMQBackend
]

export class BackendFactory {
  constructor(
    private readonly constructors: readonly BackendConstructor[] = defaultConstructors
  ) {}

  getBackend(url: string): Backend | undefined {
    const constructorFunc = this.constructors.find((backendConstructor) =>
      backendConstructor.accepts(url)
    )

    return constructorFunc && new constructorFunc(url)
  }
}
