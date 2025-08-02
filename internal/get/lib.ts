import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import * as path from 'path'
import { z } from 'zod'

import { Octokit } from '@octokit/rest'

// Project-wide configuration from smart-docker-build.yml file
interface ProjectConfig {
  imageTagsOnTagPushed: string[] | null
  imageTagsOnBranchPushed: string[] | null
  watchFiles: string[]
}

// Default configuration
const DEFAULT_CONFIG: ProjectConfig = {
  imageTagsOnTagPushed: ['{tag}'],
  imageTagsOnBranchPushed: ['{branch}-{timestamp}-{sha}', 'latest'],
  watchFiles: [], // Empty by default - means always build
}

// Configuration specified in Dockerfile comment area, used to override project-wide settings
// If a key is not specified, the corresponding ProjectConfig value will be used
interface DockerfileConfig {
  imageName?: string
  imageTagsOnTagPushed?: string[] | null
  imageTagsOnBranchPushed?: string[] | null
  watchFiles?: string[]
}

// Information required to build a Docker image
interface BuildArg {
  dockerfilePath: string
  imageName: string
  imageTag: string
}

interface TemplateVariables {
  [key: string]: string
}

interface GitRef {
  branch: string | null
  tag: string | null
}

interface GitHubContext {
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

interface ImageToProcess {
  dockerfilePath: string
  imageName: string
  imageTagsOnTagPushed: string[] | null
  imageTagsOnBranchPushed: string[] | null
  watchFiles: string[]
}

// Configuration schemas
const tagConfigSchema = z.union([z.literal(null), z.array(z.string())])

const configSchema = z.object({
  imageTagsOnTagPushed: tagConfigSchema.optional().default(['{tag}']),
  imageTagsOnBranchPushed: tagConfigSchema
    .optional()
    .default(['{branch}-{timestamp}-{sha}', 'latest']),
  watchFiles: z.array(z.string()).optional().default([]),
})

// Generate build arguments with smart detection
export async function generateBuildArgs(
  token: string,
  timezone: string,
  githubContext: GitHubContext,
  workingDir: string,
): Promise<BuildArg[]> {
  // Validate token
  if (!token || token.trim() === '') {
    throw new Error('❌ Token is required but not provided')
  }

  // Load configuration from project file only
  const projectConfig = loadProjectConfig(workingDir)

  // Validate template variables in tag configuration
  const availableVariables = ['tag', 'branch', 'sha', 'timestamp']
  if (projectConfig.imageTagsOnTagPushed !== null) {
    validateTemplateVariables(
      projectConfig.imageTagsOnTagPushed,
      availableVariables,
    )
  }
  if (projectConfig.imageTagsOnBranchPushed !== null) {
    validateTemplateVariables(
      projectConfig.imageTagsOnBranchPushed,
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
  const dockerfiles = findDockerfiles(workingDir)

  if (dockerfiles.length === 0) {
    throw new Error('❌ No Dockerfiles found in the repository')
  }

  const imagesToProcess: ImageToProcess[] = []

  if (dockerfiles.length === 1) {
    // Single Dockerfile: check for image name comment first
    const dockerfileConfig = extractDockerfileConfig(dockerfiles[0], workingDir)

    imagesToProcess.push({
      dockerfilePath: dockerfiles[0],
      imageName: dockerfileConfig.imageName || repository.name, // Use repository name as fallback
      imageTagsOnTagPushed: resolveConfig(
        dockerfileConfig.imageTagsOnTagPushed,
        projectConfig.imageTagsOnTagPushed,
      ),
      imageTagsOnBranchPushed: resolveConfig(
        dockerfileConfig.imageTagsOnBranchPushed,
        projectConfig.imageTagsOnBranchPushed,
      ),
      watchFiles: resolveConfig(
        dockerfileConfig.watchFiles,
        projectConfig.watchFiles,
      ),
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
        dockerfilePath: dockerfilePath,
        imageName: dockerfileConfig.imageName!,
        imageTagsOnTagPushed: resolveConfig(
          dockerfileConfig.imageTagsOnTagPushed,
          projectConfig.imageTagsOnTagPushed,
        ),
        imageTagsOnBranchPushed: resolveConfig(
          dockerfileConfig.imageTagsOnBranchPushed,
          projectConfig.imageTagsOnBranchPushed,
        ),
        watchFiles: resolveConfig(
          dockerfileConfig.watchFiles,
          projectConfig.watchFiles,
        ),
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
    // Check build conditions
    if (tag && image.imageTagsOnTagPushed !== null) {
      // Tag push: validate tags don't exist, then build
      await validateTagsBeforeBuild(
        image.imageTagsOnTagPushed,
        templateVariables,
        octokit,
        repository.owner.login,
        image.imageName,
      )

      const tags = generateTagsFromTemplates(
        image.imageTagsOnTagPushed,
        templateVariables,
      )

      for (const tagName of tags) {
        outputs.push({
          dockerfilePath: image.dockerfilePath,
          imageName: image.imageName,
          imageTag: tagName,
        })
      }
    } else if (branch && image.imageTagsOnBranchPushed !== null) {
      // Branch push: check for changes using watchFiles
      if (isBuildRequired(image.watchFiles, changedFiles)) {
        // Validate tags don't exist, then build
        await validateTagsBeforeBuild(
          image.imageTagsOnBranchPushed,
          templateVariables,
          octokit,
          repository.owner.login,
          image.imageName,
        )

        const tags = generateTagsFromTemplates(
          image.imageTagsOnBranchPushed,
          templateVariables,
        )

        for (const tagName of tags) {
          outputs.push({
            dockerfilePath: image.dockerfilePath,
            imageName: image.imageName,
            imageTag: tagName,
          })
        }
      }
    }
  }

  return outputs
}

// Load project configuration
export function loadProjectConfig(workingDir: string): ProjectConfig {
  const configPath = path.resolve(workingDir, 'smart-docker-build.yml')

  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf8')
      const rawConfig = yaml.load(configContent)
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
export function findDockerfiles(workingDir: string): string[] {
  const dockerfiles: string[] = []

  function searchDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.resolve(dir, entry.name)

      if (entry.isDirectory()) {
        // Skip common directories we don't want to search
        if (
          !['node_modules', '.git', '.github', 'dist', 'build'].includes(
            entry.name,
          )
        ) {
          searchDir(fullPath)
        }
      } else if (
        entry.name === 'Dockerfile' ||
        entry.name.startsWith('Dockerfile.')
      ) {
        const relativePath = fullPath.replace(workingDir + '/', '')
        dockerfiles.push(relativePath)
      }
    }
  }

  searchDir(workingDir)
  return dockerfiles
}

// Extract image configuration from Dockerfile comments

export function extractDockerfileConfig(
  dockerfilePath: string,
  workingDir: string,
): DockerfileConfig {
  const absolutePath = path.resolve(workingDir, dockerfilePath)

  const result: DockerfileConfig = {}

  if (!fs.existsSync(absolutePath)) {
    return result
  }

  try {
    const content = fs.readFileSync(absolutePath, 'utf8')
    const lines = content.split('\n')

    for (const line of lines.slice(0, 10)) {
      // Check first 10 lines
      // Support both "Image:" and "image:" (case insensitive)
      const imageMatch = line.match(/^#\s*[Ii]mage:\s*(.+)$/)
      if (imageMatch) {
        result.imageName = imageMatch[1].trim()
        continue
      }

      // imageTagsOnTagPushed configuration
      const tagPushedMatch = line.match(/^#\s*imageTagsOnTagPushed:\s*(.+)$/)
      if (tagPushedMatch) {
        const value = tagPushedMatch[1].trim()
        if (value === 'null') {
          result.imageTagsOnTagPushed = null
        } else {
          try {
            // Parse as JSON array
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) {
              result.imageTagsOnTagPushed = parsed
            }
          } catch {
            // If not valid JSON, treat as single string
            result.imageTagsOnTagPushed = [value]
          }
        }
        continue
      }

      // imageTagsOnBranchPushed configuration
      const branchPushedMatch = line.match(
        /^#\s*imageTagsOnBranchPushed:\s*(.+)$/,
      )
      if (branchPushedMatch) {
        const value = branchPushedMatch[1].trim()
        if (value === 'null') {
          result.imageTagsOnBranchPushed = null
        } else {
          try {
            // Parse as JSON array
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) {
              result.imageTagsOnBranchPushed = parsed
            }
          } catch {
            // If not valid JSON, treat as single string
            result.imageTagsOnBranchPushed = [value]
          }
        }
        continue
      }

      // watchFiles configuration
      const watchFilesMatch = line.match(/^#\s*watchFiles:\s*(.+)$/)
      if (watchFilesMatch) {
        const value = watchFilesMatch[1].trim()
        try {
          // Parse as JSON array
          const parsed = JSON.parse(value)
          if (Array.isArray(parsed)) {
            result.watchFiles = parsed
          }
        } catch {
          // If not valid JSON, treat as single string
          result.watchFiles = [value]
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
  workingDir: string,
): string | undefined {
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

// Check if image tag exists in GitHub Container Registry
export async function checkImageTagExists(
  octokit: Octokit,
  owner: string,
  imageName: string,
  tag: string,
): Promise<boolean> {
  try {
    // GitHub Container Registry API
    // Extract the package name from the full image name (e.g., "owner/my-app" -> "my-app")
    const packageName = imageName.includes('/')
      ? imageName.split('/').pop()
      : imageName

    const response = await octokit.request(
      'GET /user/packages/container/{package_name}/versions',
      {
        package_name: packageName,
      },
    )

    // Check if any version has the specified tag
    return response.data.some((version: any) =>
      version.metadata?.container?.tags?.includes(tag),
    )
  } catch (error) {
    // If we can't access the registry or package doesn't exist, assume tag doesn't exist
    return false
  }
}

// Validate that image tags don't already exist in registry
export async function validateTagsBeforeBuild(
  tags: string[],
  templateVariables: TemplateVariables,
  octokit: Octokit,
  owner: string,
  imageName: string,
): Promise<void> {
  // Generate final tags from templates
  const finalTags = generateTagsFromTemplates(tags, templateVariables)

  // Check each tag for existence (skip 'latest' as it's meant to be overwritten)
  for (const tag of finalTags) {
    if (tag === 'latest') {
      continue // Allow overwriting 'latest' tag
    }

    const exists = await checkImageTagExists(octokit, owner, imageName, tag)
    if (exists) {
      throw new Error(
        `❌ Image tag '${imageName}:${tag}' already exists in registry\n` +
          `💡 Solutions:\n` +
          `   - Update tag in Dockerfile comment\n` +
          `   - Use unique variables like {timestamp} or {sha}\n` +
          `   - Consider using force_overwrite flag if intentional overwrite is needed`,
      )
    }
  }
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

export function isBuildRequired(
  watchFiles: string[],
  changedFiles: { filename: string }[],
): boolean {
  // If no watchFiles specified or empty array, always build (default behavior)
  if (watchFiles.length === 0) {
    return true
  }

  // Check if any changed file matches the watch patterns
  return changedFiles.some((file) =>
    watchFiles.some((pattern) => matchesPattern(file.filename, pattern)),
  )
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

// Resolve configuration with fallback to default
function resolveConfig<T>(dockerfileValue: T | undefined, projectValue: T): T {
  return dockerfileValue !== undefined ? dockerfileValue : projectValue
}

// Simple glob pattern matching (basic implementation)
function matchesPattern(filename: string, pattern: string): boolean {
  // Very basic implementation for common patterns
  if (pattern === filename) return true

  // Handle simple * pattern (matches anything)
  if (pattern === '*') return true

  // Handle *.extension pattern (only at root level, no subdirectories)
  if (pattern.startsWith('*.')) {
    const extension = pattern.slice(2)
    return filename.endsWith('.' + extension) && !filename.includes('/')
  }

  // Handle src/**/*.js pattern (recursive directory match with extension)
  if (pattern.includes('**/*')) {
    const parts = pattern.split('**/')
    const prefix = parts[0] // e.g., "src/"
    const suffix = parts[1] // e.g., "*.js"

    if (!filename.startsWith(prefix)) return false

    if (suffix === '*') return true

    // Handle *.extension after **
    if (suffix.startsWith('*.')) {
      const extension = suffix.slice(2)
      return filename.endsWith('.' + extension)
    }

    return filename.endsWith(suffix)
  }

  // Handle src/* pattern (single directory match)
  if (pattern.includes('/*') && !pattern.includes('**')) {
    const prefix = pattern.split('/*')[0] + '/'
    const suffix = pattern.split('/*')[1]
    const afterPrefix = filename.slice(prefix.length)
    return (
      filename.startsWith(prefix) &&
      !afterPrefix.includes('/') &&
      (suffix === '*' || afterPrefix.endsWith(suffix))
    )
  }

  return filename === pattern
}
