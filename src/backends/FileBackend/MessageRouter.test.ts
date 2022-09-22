import { createHash } from 'crypto'
import { writeFile as writeFileCb } from 'fs'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { Deferred } from 'ts-deferred'
import { promisify } from 'util'
import { SUBSCRIPTIONS_DIRECTORY } from './constants'
import { MessageRouter } from './MessageRouter'
import rimrafCb from 'rimraf'

const rimraf = promisify(rimrafCb)
const writeFile = promisify(writeFileCb)

describe('FileBackend MessageRouter', () => {
  const hash = createHash('md5').update(__filename).digest('hex').toString()
  const basePath = resolve(tmpdir(), hash)
  let messageRouter: MessageRouter
  let handles: (() => unknown)[]

  beforeEach(async () => {
    await rimraf(basePath)
    messageRouter = new MessageRouter(basePath)
    await messageRouter.ready
    handles = []
  })

  afterEach(async () => {
    await messageRouter.close()
    await Promise.all(handles.map((handle) => handle()))
  })

  it('should correctly handle subscriptions disappearing', async () => {
    // This should do nothing since the file doesn't exist
    await messageRouter.subscriberChanged('hello.json')
  })

  it('should report errors that it encounters when a subscription is added', async () => {
    const deferred = new Deferred()
    messageRouter.on('error', (e) => deferred.resolve(e))

    await writeFile(
      resolve(basePath, SUBSCRIPTIONS_DIRECTORY, 'test.json'),
      'invalid-JSON'
    )

    expect(await deferred.promise).toBeInstanceOf(Error)
  })
})
