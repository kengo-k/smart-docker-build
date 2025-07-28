import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { existsSync } from 'fs'
import { load } from 'js-yaml'
import { resolve } from 'path'
import { z } from 'zod'

import { getInput, info, setFailed, setOutput, warning } from '@actions/core'
import github from '@actions/github'
import { Octokit } from '@octokit/rest'

const schema = z.object({
  path: z.string().min(1, 'Dockerfile path cannot be empty'),
  name: z.string().min(1, 'Image name cannot be empty').regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'Image name must contain only lowercase letters, numbers, dots, hyphens and underscores'),
  on_branch_changed: z.boolean().optional().default(true),
  on_branch_pushed: z.boolean().optional().default(true),
  on_tag_pushed: z.boolean().optional().default(true),
  include_branch_name: z.boolean().optional().default(true),
  include_timestamp: z.boolean().optional().default(true),
  include_commit_sha: z.boolean().optional().default(true),
})

function validateInputs(token, timezone, args) {
  info('🔍 Validating inputs...')

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

  info('✅ Basic input validation passed')
}

function validateDockerfile(dockerfilePath, imageName) {
  info(`🔍 Validating Dockerfile: ${dockerfilePath}`)

  // Check if file exists
  const absolutePath = resolve(process.cwd(), dockerfilePath)
  if (!existsSync(absolutePath)) {
    throw new Error(`❌ Dockerfile not found: ${dockerfilePath} (resolved to: ${absolutePath})`)
  }

  info(`✅ Dockerfile exists: ${dockerfilePath}`)
  return true
}

async function main() {
  const token = getInput('token')
  const timezone = getInput('timezone')
  let args

  try {
    args = load(getInput('args'))
  } catch (yamlError) {
    throw new Error(`❌ Failed to parse YAML args: ${yamlError.message}`)
  }

  // Validate basic inputs
  validateInputs(token, timezone, args)

  // Parse and validate each arg object
  const argObjs = []
  const validationErrors = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    try {
      info(`🔍 Validating configuration ${i + 1}/${args.length}...`)

      // Schema validation
      const parsedArg = schema.parse(arg)

      // Dockerfile existence validation
      try {
        validateDockerfile(parsedArg.path, parsedArg.name)
        argObjs.push(parsedArg)
        info(`✅ Configuration ${i + 1} validated successfully`)
      } catch (fileError) {
        validationErrors.push(`Configuration ${i + 1}: ${fileError.message}`)
        warning(`⚠️ Skipping configuration ${i + 1} due to validation error: ${fileError.message}`)
      }
    } catch (schemaError) {
      const errorMessage = schemaError.errors ?
        schemaError.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') :
        schemaError.message
      validationErrors.push(`Configuration ${i + 1}: ${errorMessage}`)
      warning(`⚠️ Skipping configuration ${i + 1} due to schema validation error: ${errorMessage}`)
    }
  }

  // Check if we have any valid configurations
  if (argObjs.length === 0) {
    if (validationErrors.length > 0) {
      throw new Error(`❌ No valid configurations found. Errors:\n${validationErrors.join('\n')}`)
    } else {
      throw new Error('❌ No valid configurations found')
    }
  }

  if (validationErrors.length > 0) {
    warning(`⚠️ Some configurations were skipped due to validation errors:\n${validationErrors.join('\n')}`)
  }

  info(`✅ Successfully validated ${argObjs.length}/${args.length} configurations`)

  console.log('timezone:', timezone)
  console.log('args:', argObjs)

  const octokit = new Octokit({ auth: token })
  const { repository, after, ref } = github.context.payload

  const compare = await octokit.repos.compareCommits({
    owner: repository.owner.login,
    repo: repository.name,
    base: after + '^',
    head: after,
  })

  let branch
  let tag

  if (ref.startsWith('refs/heads/')) {
    branch = ref.replace('refs/heads/', '')
  } else if (ref.startsWith('refs/tags/')) {
    tag = ref.replace('refs/tags/', '')
  } else {
    throw new Error(`Unsupported ref: ${ref}`)
  }

  const outputs = []
  for (const argObj of argObjs) {
    if (tag && argObj.on_tag_pushed) {
      outputs.push({
        path: argObj.path,
        name: argObj.name,
        tag,
      })
    }

    let buildRequired = false
    if (argObj.on_branch_changed) {
      const dockerfile = compare.data.files.find(
        (file) => file.filename === argObj.path,
      )
      if (dockerfile) {
        buildRequired = true
      }
    } else {
      buildRequired = true
    }

    if (!buildRequired) {
      console.log(`${argObj.path} has not changed, skipping build`)
      continue
    }

    if (branch && argObj.on_branch_pushed) {
      const imageTags = []
      if (argObj.include_branch_name) {
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
      const tag = imageTags.join('-')

      outputs.push({
        path: argObj.path,
        name: argObj.name,
        tag,
      })
    }
  }

  setOutput('build_args', JSON.stringify(outputs))
}

try {
  await main()
} catch (error) {
  setFailed(error.message)
}
