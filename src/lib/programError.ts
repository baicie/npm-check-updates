import { print } from '../lib/logging'
import { Options } from '../types/Options'
import chalk from './chalk'

/** Print an error. Exit the process if in CLI mode. */
function programError(
  options: Options,
  message: string | Error,
  {
    color = true,
  }: {
    // defaults to true, which uses chalk.red on the whole error message.
    // set to false to provide your own coloring.
    color?: boolean
  } = {},
): never {
  const errorMessage = typeof message === 'string' ? message : message.message || String(message)
  // Always exit in CLI mode, even if options.cli is not explicitly set.
  // Some code paths may pass options without the cli flag.
  const isCli = options.cli || process.argv[1]?.endsWith('cli.cjs') || process.argv[1]?.endsWith('ncu')
  if (isCli) {
    print(options, color ? chalk.red(errorMessage) : errorMessage, null, 'error')
    // Ensure process actually exits
    process.exitCode = 1
    process.exit(1)
    // Fallback in case exit is overridden
    throw new Error('process.exit failed')
  } else {
    throw new Error(errorMessage)
  }
}

export default programError
