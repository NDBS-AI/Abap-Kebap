import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { ALL_TARGETS, type Target } from './types'

export const SERVER_VERSION = '0.3.0'
export const DEFAULT_BASE_URL = 'https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src'
export const DEFAULT_GITHUB_API = 'https://api.github.com'
export const SOURCE_REPO = 'https://github.com/SAP/abap-atc-cr-cv-s4hc'
/** Owner and repository as the GitHub API addresses it; derived form of SOURCE_REPO. */
export const SOURCE_REPO_SLUG = 'SAP/abap-atc-cr-cv-s4hc'

export interface ServerConfig {
  dataDir: string
  baseUrl: string
  githubApiBaseUrl: string
  targetPin: Target | null
  versionPin: string | null
  adtDestinationsPath: string
  adtStateDir: string
  verbose: boolean
  userAgent: string
  /** Non-fatal configuration complaints; the server logs them to stderr at startup. */
  warnings: string[]
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1]
  const inline = argv.find((entry) => entry.startsWith(`${flag}=`))
  return inline ? inline.slice(flag.length + 1) : undefined
}

/** A placeholder the host failed to expand must never become a literal directory name. */
function usableDir(dir: string | undefined): dir is string {
  return !!dir && dir.trim() !== '' && !dir.includes('${') && isAbsolute(dir)
}

export function loadConfig(argv: string[], env: NodeJS.ProcessEnv, home: string = homedir()): ServerConfig {
  const warnings: string[] = []

  const fromArg = argValue(argv, '--data-dir')
  const fromEnv = env.ABAP_KEBAP_RELEASED_OBJECTS_DATA_DIR
  let dataDir: string
  if (usableDir(fromArg)) {
    dataDir = fromArg
  } else if (usableDir(fromEnv)) {
    dataDir = fromEnv
  } else {
    dataDir = join(home, '.abap-kebap', 'released-objects')
    if (fromArg || fromEnv) {
      warnings.push(`Unusable data directory "${fromArg ?? fromEnv}" (not absolute, or an unexpanded placeholder); using ${dataDir}`)
    }
  }

  const rawBase = env.ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL?.trim()
  let baseUrl = DEFAULT_BASE_URL
  if (rawBase) {
    if (/^https?:\/\//i.test(rawBase)) baseUrl = rawBase.replace(/\/+$/, '')
    else warnings.push('ABAP_KEBAP_RELEASED_OBJECTS_BASE_URL is not an http(s) URL; using the default SAP repository.')
  }

  const pin = env.ABAP_KEBAP_RELEASED_OBJECTS_TARGET?.trim()
  let targetPin: Target | null = null
  if (pin) {
    if ((ALL_TARGETS as string[]).includes(pin)) targetPin = pin as Target
    else warnings.push(`ABAP_KEBAP_RELEASED_OBJECTS_TARGET="${pin}" is not one of ${ALL_TARGETS.join(', ')}; ignoring it.`)
  }

  const rawVersion = env.ABAP_KEBAP_RELEASED_OBJECTS_VERSION?.trim()
  let versionPin: string | null = null
  if (rawVersion) {
    if (/^(latest|\d{4}(_\d+)?)$/.test(rawVersion)) versionPin = rawVersion
    else warnings.push(`ABAP_KEBAP_RELEASED_OBJECTS_VERSION="${rawVersion}" is not latest, YYYY or YYYY_N; ignoring it.`)
  }

  const adtStateDir = env.ABAP_KEBAP_ADT_STATE_DIR?.trim() || join(home, '.adtls')
  const adtDestinationsPath = env.ABAP_KEBAP_ADT_DESTINATIONS_PATH?.trim() || join(adtStateDir, 'destinations.json')

  return {
    dataDir,
    baseUrl,
    githubApiBaseUrl: DEFAULT_GITHUB_API,
    targetPin,
    versionPin,
    adtDestinationsPath,
    adtStateDir,
    verbose: argv.includes('--verbose'),
    userAgent: `abap-kebap-released-objects/${SERVER_VERSION}`,
    warnings,
  }
}
