import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { existsSync, readFileSync } from 'fs'
import { readdir } from 'fs/promises'
import { load } from 'js-yaml'
import { resolve } from 'path'
import { z } from 'zod'

import { Octokit } from '@octokit/rest'

// Default configuration
const DEFAULT_CONFIG = {
  tags: {
    tag_pushed: ['{tag}'],
    branch_pushed: ['{branch}-{timestamp}-{sha}'],
  },
  build: {
    on_branch_push: true,
    on_tag_push: true,
  },
}

// Configuration schemas
const configSchema = z.object({
  tags: z
    .object({
      tag_pushed: z.array(z.string()).optional().default(['{tag}']),
      branch_pushed: z
        .array(z.string())
        .optional()
        .default(['{branch}-{timestamp}-{sha}']),
    })
    .optional()
    .default(DEFAULT_CONFIG.tags),
  build: z
    .object({
      on_branch_push: z.boolean().optional().default(true),
      on_tag_push: z.boolean().optional().default(true),
    })
    .optional()
    .default(DEFAULT_CONFIG.build),
})

const imageSchema = z.object({
  dockerfile: z.string().min(1, 'Dockerfile path cannot be empty'),
  name: z
    .string()
    .min(1, 'Image name cannot be empty')
    .regex(
      /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
      'Image name must contain only lowercase letters, numbers, dots, hyphens and underscores',
    ),
})

// Load project configuration
export function loadProjectConfig(workingDir = process.cwd()) {
  const configPath = resolve(workingDir, 'smart-docker-build.yml')

  if (existsSync(configPath)) {
    try {
      const configContent = readFileSync(configPath, 'utf8')
      const rawConfig = load(configContent)
      return configSchema.parse(rawConfig)
    } catch (error) {
      throw new Error(
        `❌ Failed to parse config file ${configPath}: ${error.message}`,
      )
    }
  }

  return DEFAULT_CONFIG
}

// Find all Dockerfiles in the project
export async function findDockerfiles(workingDir = process.cwd()) {
  const dockerfiles = []

  async function searchDir(dir) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = resolve(dir, entry.name)

        if (entry.isDirectory()) {
          // Skip common directories we don't want to search
          if (
            !['node_modules', '.git', '.github', 'dist', 'build'].includes(
              entry.name,
            )
          ) {
            await searchDir(fullPath)
          }
        } else if (
          entry.name === 'Dockerfile' ||
          entry.name.startsWith('Dockerfile.')
        ) {
          const relativePath = fullPath.replace(workingDir + '/', '')
          dockerfiles.push(relativePath)
        }
      }
    } catch (error) {
      // Ignore directories we can't read
    }
  }

  await searchDir(workingDir)
  return dockerfiles
}

// Extract image name from Dockerfile comment
export function extractImageNameFromDockerfile(
  dockerfilePath,
  workingDir = process.cwd(),
) {
  const absolutePath = resolve(workingDir, dockerfilePath)

  if (!existsSync(absolutePath)) {
    return null
  }

  try {
    const content = readFileSync(absolutePath, 'utf8')
    const lines = content.split('\n')

    for (const line of lines.slice(0, 5)) {
      // Check first 5 lines only
      const match = line.match(/^#\s*Image:\s*(.+)$/)
      if (match) {
        return match[1].trim()
      }
    }
  } catch (error) {
    // Ignore read errors
  }

  return null
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

// Generate tags from templates
export function generateTagsFromTemplates(templates, variables) {
  return templates.map((template) => {
    let result = template
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{${key}}`, 'g'), value)
    }
    return result
  })
}

// Create template variables
export function createTemplateVariables(
  branch,
  tag,
  timezone,
  sha,
  repositoryName,
) {
  const variables = {
    sha: sha.substring(0, 7), // Short SHA
  }

  if (branch) {
    variables.branch = branch
  }

  if (tag) {
    variables.tag = tag
  }

  if (timezone) {
    const now = new Date()
    variables.timestamp = format(toZonedTime(now, timezone), 'yyyyMMddHHmm')
  }

  return variables
}

// Generate build arguments with smart detection
export async function generateBuildArgs(
  token,
  timezone,
  tagsYaml,
  buildYaml,
  imagesYaml,
  githubContext,
  workingDir = process.cwd(),
) {
  // Validate token
  if (!token || token.trim() === '') {
    throw new Error('❌ Token is required but not provided')
  }

  // Load configuration
  const projectConfig = loadProjectConfig(workingDir)

  // Parse YAML inputs
  let tagsConfig = projectConfig.tags
  let buildConfig = projectConfig.build
  let explicitImages = []

  if (tagsYaml) {
    try {
      const parsedTags = load(tagsYaml)
      tagsConfig = configSchema.shape.tags.parse(parsedTags)
    } catch (error) {
      throw new Error(`❌ Failed to parse tags YAML: ${error.message}`)
    }
  }

  if (buildYaml) {
    try {
      const parsedBuild = load(buildYaml)
      buildConfig = configSchema.shape.build.parse(parsedBuild)
    } catch (error) {
      throw new Error(`❌ Failed to parse build YAML: ${error.message}`)
    }
  }

  if (imagesYaml) {
    try {
      const parsedImages = load(imagesYaml)
      if (Array.isArray(parsedImages)) {
        explicitImages = parsedImages.map((img) => imageSchema.parse(img))
      }
    } catch (error) {
      throw new Error(`❌ Failed to parse images YAML: ${error.message}`)
    }
  }

  // Get repository information
  const octokit = new Octokit({ auth: token })
  const { repository, after, ref } = githubContext.payload
  const { branch, tag } = parseGitRef(ref)

  // Get repository changes for change detection
  const compare = await getRepositoryChanges(octokit, repository, after)
  const changedFiles = compare.data.files || []

  // Determine images to build
  let imagesToProcess = []

  if (explicitImages.length > 0) {
    // Use explicit image specifications (highest priority)
    imagesToProcess = explicitImages.map((img) => ({
      dockerfile: img.dockerfile,
      name: img.name,
    }))
  } else {
    // Auto-detect Dockerfiles
    const dockerfiles = await findDockerfiles(workingDir)

    if (dockerfiles.length === 0) {
      throw new Error('❌ No Dockerfiles found in the repository')
    }

    if (dockerfiles.length === 1) {
      // Single Dockerfile: use repository name
      imagesToProcess.push({
        dockerfile: dockerfiles[0],
        name: repository.name,
      })
    } else {
      // Multiple Dockerfiles: require image names
      for (const dockerfilePath of dockerfiles) {
        const imageName = extractImageNameFromDockerfile(
          dockerfilePath,
          workingDir,
        )

        if (!imageName) {
          throw new Error(
            `❌ Multiple Dockerfiles found but no image name specified for ${dockerfilePath}\n` +
              `💡 Solutions:\n` +
              `   - Add comment: # Image: my-image-name\n` +
              `   - Use explicit images parameter in action`,
          )
        }

        imagesToProcess.push({
          dockerfile: dockerfilePath,
          name: imageName,
        })
      }
    }
  }

  // Validate all Dockerfiles exist
  for (const image of imagesToProcess) {
    validateDockerfile(image.dockerfile, workingDir)
  }

  // Generate build arguments based on git event
  const outputs = []
  const templateVariables = createTemplateVariables(
    branch,
    tag,
    timezone,
    after,
    repository.name,
  )

  for (const image of imagesToProcess) {
    // Check build conditions
    if (tag && buildConfig.on_tag_push) {
      // Tag push: always build
      const tags = generateTagsFromTemplates(
        tagsConfig.tag_pushed,
        templateVariables,
      )

      for (const tagName of tags) {
        outputs.push({
          path: image.dockerfile,
          name: image.name,
          tag: tagName,
        })
      }
    } else if (branch && buildConfig.on_branch_push) {
      // Branch push: check for changes
      const hasChanges = changedFiles.some(
        (file) => file.filename === image.dockerfile,
      )

      if (hasChanges) {
        const tags = generateTagsFromTemplates(
          tagsConfig.branch_pushed,
          templateVariables,
        )

        for (const tagName of tags) {
          outputs.push({
            path: image.dockerfile,
            name: image.name,
            tag: tagName,
          })
        }
      }
    }
  }

  return {
    buildArgs: outputs,
    validationErrors: [],
  }
}
