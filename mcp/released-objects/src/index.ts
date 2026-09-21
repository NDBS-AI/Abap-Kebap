#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { CacheManager } from './cache'
import { DEFAULT_BASE_URL, loadConfig, SERVER_VERSION, SOURCE_REPO_SLUG } from './config'
import { coreFileSpecs, DatasetRegistry } from './datasets'
import { createHttpClient } from './http'
import { PartnerIndex } from './partner-index'
import {
  checkObjectsSchema,
  checkObjectsShape,
  datasetInfoSchema,
  datasetInfoShape,
  searchObjectsSchema,
  searchObjectsShape,
} from './schemas'
import { CHECK_OBJECTS_DESCRIPTION, handleCheckObjects } from './tools/check-objects'
import { DATASET_INFO_DESCRIPTION, handleDatasetInfo } from './tools/dataset-info'
import { toolFailure, type ServerContext, type ToolResult } from './tools/context'
import { handleSearchObjects, SEARCH_OBJECTS_DESCRIPTION } from './tools/search-objects'

export const MIN_NODE_MAJOR = 20

export function assertNodeVersion(version: string): void {
  const major = Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '0', 10)
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    throw new Error(
      `The released-objects MCP server needs Node.js ${MIN_NODE_MAJOR} or newer, and this is ${version}. ` +
        'Install a current Node.js and restart Claude Code.',
    )
  }
}

type Sink = { write(chunk: string): unknown }

/** Diagnostics go to stderr; stdout belongs to the MCP protocol and nothing else may touch it. */
export function createLogger(verbose: boolean, stderr: Sink = process.stderr, _stdout: Sink = process.stdout) {
  return (message: string) => {
    if (verbose) stderr.write(`[released-objects] ${message}\n`)
  }
}

export function buildContext(argv: string[], env: NodeJS.ProcessEnv): ServerContext {
  const config = loadConfig(argv, env)
  const log = createLogger(config.verbose)
  const http = createHttpClient(config.userAgent)
  // The GitHub API is only reachable, and only meaningful, when reading SAP's own repository.
  // Against an internal mirror the server stays on plain file fetches and the built-in partner list.
  const isDefaultSource = config.baseUrl === DEFAULT_BASE_URL
  const githubApi = isDefaultSource ? { baseUrl: config.githubApiBaseUrl, repo: SOURCE_REPO_SLUG } : null
  const cache = new CacheManager({
    dataDir: config.dataDir,
    baseUrl: config.baseUrl,
    githubApi,
    http,
    now: () => new Date(),
    log,
  })
  return {
    cache,
    registry: new DatasetRegistry(cache),
    partnerIndex: new PartnerIndex({
      http,
      apiBaseUrl: isDefaultSource ? config.githubApiBaseUrl : null,
      repo: SOURCE_REPO_SLUG,
    }),
    config,
  }
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (input: never) => Promise<ToolResult>
}

/**
 * The SDK validates a call against the raw shape only, so the cross-field rules that hang off the
 * full schema — a `version` or a `maxLevel` on a target that has neither — would never run. Parsing
 * the full schema here is the one place they do, and a rejection comes back as a tool error the
 * calling model can act on rather than a protocol-level fault.
 */
function guarded<Input>(
  schema: { parse(value: unknown): Input },
  handle: (input: Input) => Promise<ToolResult>,
): (input: never) => Promise<ToolResult> {
  return async (input: never) => {
    let parsed: Input
    try {
      parsed = schema.parse(input)
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error
      const issues = error.issues.map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
      return toolFailure('INVALID_ARGUMENT', issues.join('; '))
    }
    return handle(parsed)
  }
}

export function toolDefinitions(context: ServerContext): ToolDefinition[] {
  return [
    {
      name: 'check_objects',
      description: CHECK_OBJECTS_DESCRIPTION,
      inputSchema: checkObjectsShape,
      handler: guarded(checkObjectsSchema, (input) => handleCheckObjects(context, input)),
    },
    {
      name: 'search_objects',
      description: SEARCH_OBJECTS_DESCRIPTION,
      inputSchema: searchObjectsShape,
      handler: guarded(searchObjectsSchema, (input) => handleSearchObjects(context, input)),
    },
    {
      name: 'dataset_info',
      description: DATASET_INFO_DESCRIPTION,
      inputSchema: datasetInfoShape,
      handler: guarded(datasetInfoSchema, (input) => handleDatasetInfo(context, input)),
    },
  ]
}

export function createServer(context: ServerContext): McpServer {
  const server = new McpServer({ name: 'released-objects', version: SERVER_VERSION })
  for (const tool of toolDefinitions(context)) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema as never }, tool.handler as never)
  }
  return server
}

export async function main(): Promise<void> {
  assertNodeVersion(process.version)
  const context = buildContext(process.argv.slice(2), process.env)
  for (const warning of context.config.warnings) process.stderr.write(`[released-objects] ${warning}\n`)

  const server = createServer(context)
  await server.connect(new StdioServerTransport())

  // Open the once-a-day gate as soon as the client is connected, without blocking the first tool call.
  context.cache.ensureFresh(coreFileSpecs())
}

// `require.main` is CommonJS; the bundle is CommonJS, so this is the entry guard.
if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`[released-objects] fatal: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
