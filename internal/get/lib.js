import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { existsSync } from 'fs'
import { load } from 'js-yaml'
import { resolve } from 'path'
import { z } from 'zod'

import { Octokit } from '@octokit/rest'

const schema = z.object({
  path: z.string().min(1, 'Dockerfile path cannot be empty'),
  name: z
    .string()
    .min(1, 'Image name cannot be empty')
    .regex(
      /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
      'Image name must contain only lowercase letters, numbers, dots, hyphens and underscores',
    ),
  on_branch_changed: z.boolean().optional().default(true),
  on_branch_pushed: z.boolean().optional().default(true),
  on_tag_pushed: z.boolean().optional().default(true),
  include_branch_name: z.boolean().optional().default(true),
  include_timestamp: z.boolean().optional().default(true),
  include_commit_sha: z.boolean().optional().default(true),
})

export function validateInputs(token, timezone, args) {
  // Token validation
  if (!token || token.trim() === '') {
    throw new Error('❌ Token is required but not provided')
  }

  // Timezone validation
  if (!timezone || timezone.trim() === '') {
    throw new Error('❌ Timezone is required but not provided')
  }

  // Args validation
  if (!args || !Array.isArray(args) || args.length === 0) {
    throw new Error('❌ Args must be a non-empty array')
  }
}

export function validateDockerfile(dockerfilePath, workingDir = process.cwd()) {
  // Check if file exists
  const absolutePath = resolve(workingDir, dockerfilePath)
  if (!existsSync(absolutePath)) {
    throw new Error(
      `❌ Dockerfile not found: ${dockerfilePath} (resolved to: ${absolutePath})`,
    )
  }

  return true
}

export function parseArgs(argsYaml) {
  try {
    return load(argsYaml)
  } catch (yamlError) {
    throw new Error(`❌ Failed to parse YAML args: ${yamlError.message}`)
  }
}

export function validateAndParseConfigurations(args) {
  const argObjs = []
  const validationErrors = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    try {
      // Schema validation
      const parsedArg = schema.parse(arg)

      // Dockerfile existence validation
      try {
        validateDockerfile(parsedArg.path)
        argObjs.push(parsedArg)
      } catch (fileError) {
        validationErrors.push(`Configuration ${i + 1}: ${fileError.message}`)
      }
    } catch (schemaError) {
      const errorMessage = schemaError.errors
        ? schemaError.errors
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join(', ')
        : schemaError.message
      validationErrors.push(`Configuration ${i + 1}: ${errorMessage}`)
    }
  }

  // Check if we have any valid configurations
  if (argObjs.length === 0) {
    if (validationErrors.length > 0) {
      throw new Error(
        `❌ No valid configurations found. Errors:\n${validationErrors.join('\n')}`,
      )
    } else {
      throw new Error('❌ No valid configurations found')
    }
  }

  return {
    validConfigurations: argObjs,
    validationErrors,
  }
}

export async function getRepositoryChanges(octokit, repository, after) {
  return await octokit.repos.compareCommits({
    owner: repository.owner.login,
    repo: repository.name,
    base: after + '^',
    head: after,
  })
}

export function parseGitRef(ref) {
  let branch = null
  let tag = null

  if (ref.startsWith('refs/heads/')) {
    branch = ref.replace('refs/heads/', '')
  } else if (ref.startsWith('refs/tags/')) {
    tag = ref.replace('refs/tags/', '')
  } else {
    throw new Error(`Unsupported ref: ${ref}`)
  }

  return { branch, tag }
}

export function shouldBuildForChanges(argObj, changedFiles) {
  if (!argObj.on_branch_changed) {
    return true // Always build if change checking is disabled
  }

  const dockerfile = changedFiles.find((file) => file.filename === argObj.path)
  return !!dockerfile
}

export function generateImageTag(argObj, branch, timezone, after) {
  const imageTags = []

  if (argObj.include_branch_name && branch) {
    imageTags.push(branch)
  }

  if (argObj.include_timestamp) {
    const now = new Date()
    const formattedDate = format(toZonedTime(now, timezone), 'yyyyMMddHHmm')
    imageTags.push(formattedDate)
  }

  if (argObj.include_commit_sha) {
    imageTags.push(after)
  }

  return imageTags.join('-')
}

export async function generateBuildArgs(
  token,
  timezone,
  argsYaml,
  githubContext,
) {
  // Parse and validate inputs
  const args = parseArgs(argsYaml)
  validateInputs(token, timezone, args)

  // Validate configurations
  const { validConfigurations, validationErrors } =
    validateAndParseConfigurations(args)

  // Get repository changes
  const octokit = new Octokit({ auth: token })
  const { repository, after, ref } = githubContext.payload
  const compare = await getRepositoryChanges(octokit, repository, after)

  // Parse git ref
  const { branch, tag } = parseGitRef(ref)

  // Generate build arguments
  const outputs = []

  for (const argObj of validConfigurations) {
    // Handle tag pushes
    if (tag && argObj.on_tag_pushed) {
      outputs.push({
        path: argObj.path,
        name: argObj.name,
        tag,
      })
      continue
    }

    // Handle branch pushes
    if (branch && argObj.on_branch_pushed) {
      // Check if build is required based on changes
      if (!shouldBuildForChanges(argObj, compare.data.files)) {
        continue // Skip this configuration
      }

      const imageTag = generateImageTag(argObj, branch, timezone, after)
      outputs.push({
        path: argObj.path,
        name: argObj.name,
        tag: imageTag,
      })
    }
  }

  return {
    buildArgs: outputs,
    validationErrors,
  }
}
