import { createHash } from 'crypto'
import {
  chmod as chmodCb,
  mkdir as mkdirCb,
  utimes as utimesCb,
  writeFile as writeFileCb
} from 'fs'
import { tmpdir } from 'os'
import { resolve } from 'path'
import rimrafCb from 'rimraf'
import { Deferred } from 'ts-deferred'
import { promisify } from 'util'
import { PROCESSING_DIRECTORY, READY_DIRECTORY } from './constants'
import { Watchdog } from './Watchdog'

const chmod = promisify(chmodCb)
const mkdir = promisify(mkdirCb)
const rimraf = promisify(rimrafCb)
const utimes = promisify(utimesCb)
const writeFile = promisify(writeFileCb)

const READ_ONLY = 0o500

jest.useFakeTimers()

describe('FileBackend Watchdog', () => {
  const hash = createHash('md5').update(__filename).digest('hex').toString()
  const basePath = resolve(tmpdir(), hash)
  const filePath = resolve(basePath, PROCESSING_DIRECTORY, 'test.json')
  let watchdog: Watchdog

  beforeEach(async () => {
    await rimraf(basePath)
    await mkdir(resolve(basePath, READY_DIRECTORY), { recursive: true })
    await mkdir(resolve(basePath, PROCESSING_DIRECTORY), { recursive: true })
    await writeFile(filePath, Buffer.from(JSON.stringify('hi there')))
    await utimes(filePath, new Date('2000-01-01'), new Date('2000-01-01'))

    watchdog = new Watchdog()
    watchdog.watch(basePath)
  })

  it('should emit an error when something goes wrong', async () => {
    await chmod(resolve(basePath, READY_DIRECTORY), READ_ONLY)

    const deferred = new Deferred()
    watchdog.on('error', (e) => deferred.resolve(e))

    jest.runOnlyPendingTimers()

    expect(await deferred.promise).toMatchObject({ code: 'EACCES' })
  })

  it('test restoring file that no longer exists', async () => {
    await watchdog['restorePath'](
      resolve(basePath, PROCESSING_DIRECTORY, 'non-existent.json')
    )
  })

  it("should correctly handle watching paths that don't exist", async () => {
    const errorHandler = jest.fn()
    watchdog.watch(`${basePath}-non-existent`)
    watchdog.on('error', errorHandler)

    await watchdog['checkWatchedMessages']()

    expect(errorHandler).not.toBeCalled()
  })
})
