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

// Configuration specified in Dockerfile comment area, used to override project-wide settings
// If a key is not specified, the corresponding ProjectConfig value will be used
interface DockerfileConfig {
  imageName?: string
  imageTagsOnTagPushed?: string[] | null
  imageTagsOnBranchPushed?: string[] | null
  watchFiles?: string[]
}

// Consolidated build specification that combines project settings and Dockerfile comments
// Contains all necessary information for building a single Docker image
interface ImageBuildSpec {
  dockerfilePath: string
  imageName: string
  imageTagsOnTagPushed: string[] | null
  imageTagsOnBranchPushed: string[] | null
  watchFiles: string[]
}

// Final result of this JavaScript action that will be passed to subsequent workflow steps
// Contains the resolved build parameters for Docker image construction
interface ActionResult {
  dockerfilePath: string
  imageName: string
  imageTag: string
}

interface TemplateVariables {
  tag?: string
  branch?: string
  sha?: string
  timestamp?: string
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
    before?: string
    after?: string
    ref?: string
  }
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
): Promise<ActionResult[]> {
  // Validate token
  if (!token || token.trim() === '') {
    throw new Error('Token is required but not provided')
  }

  // Load configuration from project file only
  const projectConfig = loadProjectConfig(workingDir)
  console.log('load projectConfig: ', projectConfig)

  // Validate template variables in tag configuration
  const availableVariables: (keyof TemplateVariables)[] = [
    'tag',
    'branch',
    'sha',
    'timestamp',
  ]
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
  const { repository, before, after, ref } = githubContext.payload

  if (!repository || !before || !after || !ref) {
    throw new Error(
      'Missing required GitHub context information (repository, before, after, ref)',
    )
  }

  console.log('parseGitRef: ', ref)
  const { branch, tag } = parseGitRef(ref)
  console.log('branch: ', branch)
  console.log('before: ', before)
  console.log('after: ', after)
  console.log('tag: ', tag)

  // Get repository changes for change detection
  const compare = await getRepositoryChanges(octokit, repository, before, after)
  const changedFiles = compare.data.files || []
  console.log(
    'changedFiles: ',
    changedFiles.map((file) => file.filename),
  )

  // Auto-detect Dockerfiles and determine images to build
  const dockerfiles = findDockerfiles(workingDir)
  console.log('dockerfiles: ', dockerfiles)

  if (dockerfiles.length === 0) {
    throw new Error('❌ No Dockerfiles found in the repository')
  }

  const imageBuildSpecs: ImageBuildSpec[] = []

  if (dockerfiles.length === 1) {
    // Single Dockerfile: check for image name comment first
    const dockerfileConfig = extractDockerfileConfig(dockerfiles[0], workingDir)

    imageBuildSpecs.push({
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

      imageBuildSpecs.push({
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
  const outputs: ActionResult[] = []
  const templateVariables = createTemplateVariables(
    branch,
    tag,
    timezone,
    after,
  )

  for (const spec of imageBuildSpecs) {
    // Check build conditions
    if (tag && spec.imageTagsOnTagPushed !== null) {
      // Tag push: validate tags don't exist, then build
      await ensureUniqueTag(
        spec.imageTagsOnTagPushed,
        templateVariables,
        octokit,
        spec.imageName,
      )

      const tags = generateTags(spec.imageTagsOnTagPushed, templateVariables)

      for (const tagName of tags) {
        outputs.push({
          dockerfilePath: spec.dockerfilePath,
          imageName: spec.imageName,
          imageTag: tagName,
        })
      }
    } else if (branch && spec.imageTagsOnBranchPushed !== null) {
      // Branch push: check for changes using watchFiles
      if (isBuildRequired(spec.watchFiles, changedFiles)) {
        // Validate tags don't exist, then build
        await ensureUniqueTag(
          spec.imageTagsOnBranchPushed,
          templateVariables,
          octokit,
          spec.imageName,
        )

        const tags = generateTags(
          spec.imageTagsOnBranchPushed,
          templateVariables,
        )

        for (const tagName of tags) {
          outputs.push({
            dockerfilePath: spec.dockerfilePath,
            imageName: spec.imageName,
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

  return {
    imageTagsOnTagPushed: ['{tag}'],
    imageTagsOnBranchPushed: ['{branch}-{timestamp}-{sha}', 'latest'],
    watchFiles: [], // Empty by default - means always build
  }
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
        let parsed
        try {
          parsed = JSON.parse(value)
        } catch (error) {
          throw new Error(
            `❌ Invalid JSON syntax for imageTagsOnTagPushed in ${absolutePath}: "${value}". Expected valid JSON array like ["tag1", "tag2"].`,
          )
        }

        if (!Array.isArray(parsed)) {
          throw new Error(
            `❌ imageTagsOnTagPushed must be an array in ${absolutePath}: "${value}". Expected JSON array like ["tag1", "tag2"], got ${typeof parsed}.`,
          )
        }

        result.imageTagsOnTagPushed = parsed
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
        let parsed
        try {
          parsed = JSON.parse(value)
        } catch (error) {
          throw new Error(
            `❌ Invalid JSON syntax for imageTagsOnBranchPushed in ${absolutePath}: "${value}". Expected valid JSON array like ["tag1", "tag2"].`,
          )
        }

        if (!Array.isArray(parsed)) {
          throw new Error(
            `❌ imageTagsOnBranchPushed must be an array in ${absolutePath}: "${value}". Expected JSON array like ["tag1", "tag2"], got ${typeof parsed}.`,
          )
        }

        result.imageTagsOnBranchPushed = parsed
      }
      continue
    }

    // watchFiles configuration
    const watchFilesMatch = line.match(/^#\s*watchFiles:\s*(.+)$/)
    if (watchFilesMatch) {
      const value = watchFilesMatch[1].trim()
      let parsed
      try {
        parsed = JSON.parse(value)
      } catch (error) {
        throw new Error(
          `❌ Invalid JSON syntax for watchFiles in ${absolutePath}: "${value}". Expected valid JSON array like ["file1", "file2"].`,
        )
      }

      if (!Array.isArray(parsed)) {
        throw new Error(
          `❌ watchFiles must be an array in ${absolutePath}: "${value}". Expected JSON array like ["file1", "file2"], got ${typeof parsed}.`,
        )
      }

      result.watchFiles = parsed
      continue
    }
  }

  return result
}

export async function getRepositoryChanges(
  octokit: Octokit,
  repository: { owner: { login: string }; name: string },
  before: string,
  after: string,
) {
  return await octokit.repos.compareCommits({
    owner: repository.owner.login,
    repo: repository.name,
    base: before,
    head: after,
  })
}

// Check if image tag exists in GitHub Container Registry
export async function checkImageTagExists(
  octokit: Octokit,
  imageName: string,
  tag: string,
): Promise<boolean> {
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
}

// Ensure image tags are unique in registry
export async function ensureUniqueTag(
  tags: string[],
  templateVariables: TemplateVariables,
  octokit: Octokit,
  imageName: string,
): Promise<void> {
  // Generate final tags from templates
  const finalTags = generateTags(tags, templateVariables)

  // Check each tag for existence (skip 'latest' as it's meant to be overwritten)
  for (const tag of finalTags) {
    if (tag === 'latest') {
      continue // Allow overwriting 'latest' tag
    }

    const exists = await checkImageTagExists(octokit, imageName, tag)
    if (exists) {
      throw new Error(
        `Image tag '${imageName}:${tag}' already exists in registry`,
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
      `Invalid template variables found: {${missingVariables.join('}, {')}}`,
    )
  }
}

// Generate tags from templates
export function generateTags(
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
