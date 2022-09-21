import { BackendSubscriber } from '../../types'

export type ExternalSubscriber = Pick<BackendSubscriber, 'queueName' | 'topics'>
