export const abortError = () => new DOMException('Операция отменена', 'AbortError')
const signalError = (signal: AbortSignal) =>
  signal.reason instanceof Error ? signal.reason : abortError()
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signalError(signal)
}
export function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signalError(signal))
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(signalError(signal))
    }
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(asError(error))
      },
    )
  })
}
import { asError } from '../domain/model.ts'
