/**
 * Shim for p-map that handles ESM/CJS interop issues.
 * p-map is an ESM-only package, and rolldown doesn't handle its default export correctly.
 */
import pMapModule from 'p-map'

type PMapFunction = <T, R = T>(
  iterable: Iterable<T> | AsyncIterable<T>,
  mapper: (element: T, index: number) => Promise<R>,
  options?: { concurrency?: number; stopOnError?: boolean },
) => Promise<R[]>

const pMap: PMapFunction =
  typeof pMapModule === 'function' ? (pMapModule as PMapFunction) : (pMapModule as { default: PMapFunction }).default

export default pMap
