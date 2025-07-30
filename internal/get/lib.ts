import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { existsSync, readFileSync } from 'fs'
import { readdir } from 'fs/promises'
import { load } from 'js-yaml'
import { resolve } from 'path'
import { z } from 'zod'

import { Octokit } from '@octokit/rest'

// Types
export type TagConfig = false | string[]

export interface Config {
  imagetag_on_tag_pushed: TagConfig
  imagetag_on_branch_pushed: TagConfig
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
  imagetag_on_tag_pushed: ['{tag}'],
  imagetag_on_branch_pushed: ['{branch}-{timestamp}-{sha}', 'latest'],
}

// Configuration schemas
const tagConfigSchema = z.union([z.literal(false), z.array(z.string())])

const configSchema = z.object({
  imagetag_on_tag_pushed: tagConfigSchema.optional().default(['{tag}']),
  imagetag_on_branch_pushed: tagConfigSchema
    .optional()
    .default(['{branch}-{timestamp}-{sha}', 'latest']),
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

// Extract image configuration from Dockerfile comments
export interface DockerfileConfig {
  imageName: string | null
  imagetagOnTagPushed: TagConfig | null
  imagetagOnBranchPushed: TagConfig | null
}

export function extractDockerfileConfig(
  dockerfilePath: string,
  workingDir: string = process.cwd(),
): DockerfileConfig {
  const absolutePath = resolve(workingDir, dockerfilePath)

  const result: DockerfileConfig = {
    imageName: null,
    imagetagOnTagPushed: null,
    imagetagOnBranchPushed: null,
  }

  if (!existsSync(absolutePath)) {
    return result
  }

  try {
    const content = readFileSync(absolutePath, 'utf8')
    const lines = content.split('\n')

    for (const line of lines.slice(0, 10)) {
      // Check first 10 lines
      // Support both "Image:" and "image:" (case insensitive)
      const imageMatch = line.match(/^#\s*[Ii]mage:\s*(.+)$/)
      if (imageMatch) {
        result.imageName = imageMatch[1].trim()
        continue
      }

      // imagetag_on_tag_pushed configuration
      const tagPushedMatch = line.match(/^#\s*imagetag_on_tag_pushed:\s*(.+)$/)
      if (tagPushedMatch) {
        const value = tagPushedMatch[1].trim()
        if (value === 'false') {
          result.imagetagOnTagPushed = false
        } else {
          try {
            // Parse as JSON array
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) {
              result.imagetagOnTagPushed = parsed
            }
          } catch {
            // If not valid JSON, treat as single string
            result.imagetagOnTagPushed = [value]
          }
        }
        continue
      }

      // imagetag_on_branch_pushed configuration
      const branchPushedMatch = line.match(
        /^#\s*imagetag_on_branch_pushed:\s*(.+)$/,
      )
      if (branchPushedMatch) {
        const value = branchPushedMatch[1].trim()
        if (value === 'false') {
          result.imagetagOnBranchPushed = false
        } else {
          try {
            // Parse as JSON array
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) {
              result.imagetagOnBranchPushed = parsed
            }
          } catch {
            // If not valid JSON, treat as single string
            result.imagetagOnBranchPushed = [value]
          }
        }
        continue
      }
    }
  } catch (error) {
    // Ignore read errors
  }

  return result
}

// Legacy function for backward compatibility
export function extractImageNameFromDockerfile(
  dockerfilePath: string,
  workingDir: string = process.cwd(),
): string | null {
  return extractDockerfileConfig(dockerfilePath, workingDir).imageName
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

// Validate template variables exist
export function validateTemplateVariables(
  templates: string[],
  availableVariables: string[],
): void {
  const variablePattern = /\{(\w+)\}/g
  const missingVariables: string[] = []

  for (const template of templates) {
    let match
    while ((match = variablePattern.exec(template)) !== null) {
      const variableName = match[1]
      if (!availableVariables.includes(variableName)) {
        if (!missingVariables.includes(variableName)) {
          missingVariables.push(variableName)
        }
      }
    }
  }

  if (missingVariables.length > 0) {
    throw new Error(
      `❌ Invalid template variables found: {${missingVariables.join('}, {')}}\n` +
        `💡 Available variables: {${availableVariables.join('}, {')}}`,
    )
  }
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
  githubContext: GitHubContext,
  workingDir: string = process.cwd(),
): Promise<GenerateBuildArgsResult> {
  // Validate token
  if (!token || token.trim() === '') {
    throw new Error('❌ Token is required but not provided')
  }

  // Load configuration from project file only
  const projectConfig = loadProjectConfig(workingDir)

  // Validate template variables in tag configuration
  const availableVariables = ['tag', 'branch', 'sha', 'timestamp']
  if (Array.isArray(projectConfig.imagetag_on_tag_pushed)) {
    validateTemplateVariables(
      projectConfig.imagetag_on_tag_pushed,
      availableVariables,
    )
  }
  if (Array.isArray(projectConfig.imagetag_on_branch_pushed)) {
    validateTemplateVariables(
      projectConfig.imagetag_on_branch_pushed,
      availableVariables,
    )
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

  // Auto-detect Dockerfiles and determine images to build
  const dockerfiles = await findDockerfiles(workingDir)

  if (dockerfiles.length === 0) {
    throw new Error('❌ No Dockerfiles found in the repository')
  }

  interface ImageToProcess extends ImageSpec {
    dockerfileConfig: DockerfileConfig
  }

  const imagesToProcess: ImageToProcess[] = []

  if (dockerfiles.length === 1) {
    // Single Dockerfile: check for image name comment first
    const dockerfileConfig = extractDockerfileConfig(dockerfiles[0], workingDir)

    imagesToProcess.push({
      dockerfile: dockerfiles[0],
      name: dockerfileConfig.imageName || repository.name, // Use repository name as fallback
      dockerfileConfig,
    })
  } else {
    // Multiple Dockerfiles: require image names
    for (const dockerfilePath of dockerfiles) {
      const dockerfileConfig = extractDockerfileConfig(
        dockerfilePath,
        workingDir,
      )

      if (!dockerfileConfig.imageName) {
        throw new Error(
          `❌ Multiple Dockerfiles found but no image name specified for ${dockerfilePath}\n` +
            `💡 Solutions:\n` +
            `   - Add comment: # image: my-image-name\n` +
            `   - Create smart-docker-build.yml with explicit image configurations`,
        )
      }

      imagesToProcess.push({
        dockerfile: dockerfilePath,
        name: dockerfileConfig.imageName,
        dockerfileConfig,
      })
    }
  }

  // Generate build arguments based on git event
  const outputs: BuildArg[] = []
  const templateVariables = createTemplateVariables(
    branch,
    tag,
    timezone,
    after,
  )

  for (const image of imagesToProcess) {
    // Get effective configuration (Dockerfile config overrides project config)
    const effectiveTagPushedConfig =
      image.dockerfileConfig.imagetagOnTagPushed !== null
        ? image.dockerfileConfig.imagetagOnTagPushed
        : projectConfig.imagetag_on_tag_pushed

    const effectiveBranchPushedConfig =
      image.dockerfileConfig.imagetagOnBranchPushed !== null
        ? image.dockerfileConfig.imagetagOnBranchPushed
        : projectConfig.imagetag_on_branch_pushed

    // Check build conditions
    if (tag && Array.isArray(effectiveTagPushedConfig)) {
      // Tag push: always build if config is array
      const tags = generateTagsFromTemplates(
        effectiveTagPushedConfig,
        templateVariables,
      )

      for (const tagName of tags) {
        outputs.push({
          path: image.dockerfile,
          name: image.name,
          tag: tagName,
        })
      }
    } else if (branch && Array.isArray(effectiveBranchPushedConfig)) {
      // Branch push: check for changes
      const hasChanges = changedFiles.some(
        (file) => file.filename === image.dockerfile,
      )

      if (hasChanges) {
        const tags = generateTagsFromTemplates(
          effectiveBranchPushedConfig,
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
