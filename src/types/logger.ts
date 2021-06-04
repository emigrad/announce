// This matches the interface of Winston

export type LogCallback = (
  error?: any,
  level?: string,
  message?: string,
  meta?: any
) => void

export interface LogEntry {
  level: string
  message: string
  [optionName: string]: any
}

export interface LogMethod {
  (level: string, message: string, callback: LogCallback): Logger
  (level: string, message: string, meta: any, callback: LogCallback): Logger
  (level: string, message: string, ...meta: any[]): Logger
  (entry: LogEntry): Logger
  (level: string, message: any): Logger
}

export interface LeveledLogMethod {
  (message: string, callback: LogCallback): Logger
  (message: string, meta: any, callback: LogCallback): Logger
  (message: string, ...meta: any[]): Logger
  (message: any): Logger
  (infoObject: object): Logger
}

export interface Logger {
  log: LogMethod

  error: LeveledLogMethod
  warn: LeveledLogMethod
  help: LeveledLogMethod
  data: LeveledLogMethod
  info: LeveledLogMethod
  debug: LeveledLogMethod
  prompt: LeveledLogMethod
  http: LeveledLogMethod
  verbose: LeveledLogMethod
  input: LeveledLogMethod
  silly: LeveledLogMethod
}
