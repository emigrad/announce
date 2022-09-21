import chokidar, { FSWatcher } from 'chokidar'
import createDebug from 'debug'
import { EventEmitter } from 'events'
import { rename as renameCb, Stats } from 'fs'
import { join, sep } from 'path'
import { clearInterval } from 'timers'
import { promisify } from 'util'
import {
  KEEPALIVE_INTERVAL,
  PROCESSING_DIRECTORY,
  READY_DIRECTORY,
  RESTORE_MESSAEGS_AFTER
} from './constants'
import { isFileNotFoundError } from './util'

const debug = createDebug('announce:FileBackend:Watchdog')
const rename = promisify(renameCb)

export class Watchdog extends EventEmitter {
  private readonly processingTimesByPath: Record<string, number> = {}
  private readonly watchersByPath: Record<string, FSWatcher> = {}
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

  async watch(path: string): Promise<void> {
    if (this.watchersByPath[path]) {
      return
    }

    const watcher = chokidar
      .watch(join(path, PROCESSING_DIRECTORY, '*.json'), { alwaysStat: true })
      .on('add', this.fileChanged.bind(this))
      .on('change', this.fileChanged.bind(this))
      .on('unlink', this.fileUnlinked.bind(this))

    this.watchersByPath[path] = watcher

    return new Promise((resolve, reject) => {
      watcher.on('ready', resolve)
      watcher.on('error', reject)
    })
  }

  private fileChanged(path: string, stats: Stats) {
    debug(`Message ${path} added or changed, modtime ${stats.mtime}`)
    this.processingTimesByPath[path] = stats.mtimeMs
  }

  private fileUnlinked(path: string) {
    debug(`Message ${path} removed`)
    delete this.processingTimesByPath[path]
  }

  private async checkWatchedMessages(): Promise<void> {
    const restoreCutoff = Date.now() - RESTORE_MESSAEGS_AFTER
    const pathsToRestore = Object.keys(this.processingTimesByPath).filter(
      (path) => this.processingTimesByPath[path] < restoreCutoff
    )

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

  async close() {
    clearInterval(this.timer)
    await Promise.all(
      Object.values(this.watchersByPath).map((watcher) => watcher.close())
    )
  }
}

function getReadyPath(processingPath: string): string {
  const pathParts = processingPath.split(sep)
  pathParts[pathParts.length - 2] = READY_DIRECTORY

  return pathParts.join(sep)
}
