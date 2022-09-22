import createDebug from 'debug'
import { EventEmitter } from 'events'
import {
  readdir as readdirCb,
  rename as renameCb,
  stat as statCb,
  Stats
} from 'fs'
import { join, sep } from 'path'
import { clearInterval } from 'timers'
import { promisify } from 'util'
import {
  KEEPALIVE_INTERVAL,
  PROCESSING_DIRECTORY,
  READY_DIRECTORY,
  RESTORE_MESSAGES_AFTER
} from './constants'
import { ignoreFileNotFoundErrors, isFileNotFoundError } from './util'

const debug = createDebug('announce:FileBackend:Watchdog')
const readdir = promisify(readdirCb)
const rename = promisify(renameCb)
const stat = promisify(statCb)

export class Watchdog extends EventEmitter {
  private readonly watchedPaths: Set<string> = new Set()
  private readonly timer: NodeJS.Timer

  constructor() {
    super()

    this.timer = setInterval(async () => {
      try {
        await this.checkWatchedMessages()
      } catch (e) {
        this.emit('error', e)
      }
    }, KEEPALIVE_INTERVAL).unref()
  }

  watch(path: string) {
    this.watchedPaths.add(path)
  }

  unwatch(path: string) {
    this.watchedPaths.delete(path)
  }

  private async checkWatchedMessages(): Promise<void> {
    const restoreCutoff = new Date(Date.now() - RESTORE_MESSAGES_AFTER)
    const watchedPaths = Array.from(this.watchedPaths.values())
    debug(
      `Restoring any messages in ${JSON.stringify(
        watchedPaths.map((path) => join(path, PROCESSING_DIRECTORY, '*.json'))
      )} last touched before ${restoreCutoff}`
    )

    const jsonFiles = await Promise.all(watchedPaths.map(listJsonFiles))
    const mtimes = await getMtimes(jsonFiles.flat())
    const pathsToRestore = Object.entries(mtimes)
      .filter((entry) => entry[1] < restoreCutoff)
      .map(([path]) => path)

    await Promise.all(pathsToRestore.map((path) => this.restorePath(path)))
  }

  private async restorePath(path: string): Promise<void> {
    try {
      await rename(path, getReadyPath(path))
      debug(`Restored crashed message ${path}`)
    } catch (e: unknown) {
      if (isFileNotFoundError(e)) {
        // If the file has already disappeared there's nothing else we need to do
      } else {
        throw e
      }
    }
  }

  close() {
    clearInterval(this.timer)
  }
}

function getReadyPath(processingPath: string): string {
  const pathParts = processingPath.split(sep)
  pathParts[pathParts.length - 2] = READY_DIRECTORY

  return pathParts.join(sep)
}

async function listJsonFiles(path: string): Promise<string[]> {
  const baseDir = join(path, PROCESSING_DIRECTORY)
  const files = await ignoreFileNotFoundErrors(readdir(baseDir))

  return (files ?? [])
    .filter((filename) => filename.endsWith('.json'))
    .map((filename) => join(baseDir, filename))
}

async function getMtimes(
  paths: readonly string[]
): Promise<Record<string, Date>> {
  const statsEntries: ([string, Stats] | undefined)[] = await Promise.all(
    paths.map(async (path) => {
      const stats = await ignoreFileNotFoundErrors(stat(path))

      return stats && [path, stats]
    })
  )
  const mtimeEntries = statsEntries
    .filter((entry): entry is [string, Stats] => !!entry)
    .map(([path, stat]) => [path, stat.mtime])

  return Object.fromEntries(mtimeEntries)
}
