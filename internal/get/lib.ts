import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { existsSync, readFileSync } from 'fs'
import { readdir } from 'fs/promises'
import { load } from 'js-yaml'
import { resolve } from 'path'
import { z } from 'zod'

import { Octokit } from '@octokit/rest'

// Types
export interface Config {
  tags: {
    tag_pushed: string[]
    branch_pushed: string[]
  }
  build: {
    on_branch_push: boolean
    on_tag_push: boolean
  }
}

export interface ImageSpec {
  dockerfile: string
  name: string
}

export interface BuildArg {
  path: string
  name: string
  tag: string
}

export interface GenerateBuildArgsResult {
  buildArgs: BuildArg[]
  validationErrors: string[]
}

export interface TemplateVariables {
  [key: string]: string
}

export interface GitRef {
  branch: string | null
  tag: string | null
}

export interface GitHubContext {
  payload: {
    repository?: {
      name: string
      owner: {
        login: string
      }
    }
    after?: string
    ref?: string
  }
}

// Default configuration
const DEFAULT_CONFIG: Config = {
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
export function loadProjectConfig(workingDir: string = process.cwd()): Config {
  const configPath = resolve(workingDir, 'smart-docker-build.yml')

  if (existsSync(configPath)) {
    try {
      const configContent = readFileSync(configPath, 'utf8')
      const rawConfig = load(configContent)
      return configSchema.parse(rawConfig)
    } catch (error) {
      throw new Error(
        `❌ Failed to parse config file ${configPath}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  return DEFAULT_CONFIG
}

// Find all Dockerfiles in the project
export async function findDockerfiles(
  workingDir: string = process.cwd(),
): Promise<string[]> {
  const dockerfiles: string[] = []

  async function searchDir(dir: string): Promise<void> {
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
  dockerfilePath: string,
  workingDir: string = process.cwd(),
): string | null {
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

export function validateDockerfile(
  dockerfilePath: string,
  workingDir: string = process.cwd(),
): boolean {
  // Check if file exists
  const absolutePath = resolve(workingDir, dockerfilePath)
  if (!existsSync(absolutePath)) {
    throw new Error(
      `❌ Dockerfile not found: ${dockerfilePath} (resolved to: ${absolutePath})`,
    )
  }

  return true
}

export async function getRepositoryChanges(
  octokit: Octokit,
  repository: { owner: { login: string }; name: string },
  after: string,
) {
  return await octokit.repos.compareCommits({
    owner: repository.owner.login,
    repo: repository.name,
    base: after + '^',
    head: after,
  })
}

export function parseGitRef(ref: string): GitRef {
  let branch: string | null = null
  let tag: string | null = null

  if (ref.startsWith('refs/heads/')) {
    branch = ref.replace('refs/heads/', '')
  } else if (ref.startsWith('refs/tags/')) {
    tag = ref.replace('refs/tags/', '')
  } else {
    throw new Error(`Unsupported ref: ${ref}`)
  }

  return { branch, tag }
}

export function shouldBuildForChanges(
  argObj: { on_branch_changed?: boolean; path: string },
  changedFiles: { filename: string }[],
): boolean {
  if (!argObj.on_branch_changed) {
    return true // Always build if change checking is disabled
  }

  const dockerfile = changedFiles.find((file) => file.filename === argObj.path)
  return !!dockerfile
}

export function generateImageTag(
  argObj: {
    include_branch_name?: boolean
    include_timestamp?: boolean
    include_commit_sha?: boolean
  },
  branch: string | null,
  timezone: string,
  after: string,
): string {
  const imageTags: string[] = []

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
export function generateTagsFromTemplates(
  templates: string[],
  variables: TemplateVariables,
): string[] {
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
  branch: string | null,
  tag: string | null,
  timezone: string,
  sha: string,
  repositoryName: string,
): TemplateVariables {
  const variables: TemplateVariables = {
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
  token: string,
  timezone: string,
  tagsYaml: string, // getInput always returns string, empty string if not provided
  buildYaml: string, // getInput always returns string, empty string if not provided
  imagesYaml: string, // getInput always returns string, empty string if not provided
  githubContext: GitHubContext,
  workingDir: string = process.cwd(),
): Promise<GenerateBuildArgsResult> {
  // Validate token
  if (!token || token.trim() === '') {
    throw new Error('❌ Token is required but not provided')
  }

  // Load configuration
  const projectConfig = loadProjectConfig(workingDir)

  // Parse YAML inputs
  let tagsConfig = projectConfig.tags
  let buildConfig = projectConfig.build
  let explicitImages: ImageSpec[] = []

  if (tagsYaml) {
    try {
      const parsedTags = load(tagsYaml)
      tagsConfig = configSchema.shape.tags.parse(parsedTags)
    } catch (error) {
      throw new Error(
        `❌ Failed to parse tags YAML: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  if (buildYaml) {
    try {
      const parsedBuild = load(buildYaml)
      buildConfig = configSchema.shape.build.parse(parsedBuild)
    } catch (error) {
      throw new Error(
        `❌ Failed to parse build YAML: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  if (imagesYaml) {
    try {
      const parsedImages = load(imagesYaml)
      if (Array.isArray(parsedImages)) {
        explicitImages = parsedImages.map((img) => imageSchema.parse(img))
      }
    } catch (error) {
      throw new Error(
        `❌ Failed to parse images YAML: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  // Get repository information
  const octokit = new Octokit({ auth: token })
  const { repository, after, ref } = githubContext.payload

  if (!repository || !after || !ref) {
    throw new Error(
      '❌ Missing required GitHub context information (repository, after, ref)',
    )
  }

  const { branch, tag } = parseGitRef(ref)

  // Get repository changes for change detection
  const compare = await getRepositoryChanges(octokit, repository, after)
  const changedFiles = compare.data.files || []

  // Determine images to build
  let imagesToProcess: ImageSpec[] = []

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
  const outputs: BuildArg[] = []
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
