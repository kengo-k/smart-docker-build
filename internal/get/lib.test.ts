import { afterEach, beforeEach, describe, expect, test } from '@jest/globals'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

import {
  checkImageTagExists,
  createTemplateVariables,
  extractDockerfileConfig,
  extractImageNameFromDockerfile,
  generateImageTag,
  generateTagsFromTemplates,
  loadProjectConfig,
  parseGitRef,
  shouldBuildForChanges,
  validateTagsBeforeBuild,
  validateTemplateVariables,
} from './lib.js'

// Test fixture setup
const testDir = join(process.cwd(), 'test-fixtures')

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('parseGitRef', () => {
  test('should parse branch ref', () => {
    const result = parseGitRef('refs/heads/main')
    expect(result).toEqual({ branch: 'main', tag: null })
  })

  test('should parse tag ref', () => {
    const result = parseGitRef('refs/tags/v1.0.0')
    expect(result).toEqual({ branch: null, tag: 'v1.0.0' })
  })

  test('should throw error for unsupported ref', () => {
    expect(() => {
      parseGitRef('refs/unknown/something')
    }).toThrow('Unsupported ref')
  })
})

describe('shouldBuildForChanges', () => {
  test('should return true when no watch_files specified (default behavior)', () => {
    const changedFiles: { filename: string }[] = [
      { filename: 'src/app.js' },
      { filename: 'README.md' },
    ]

    expect(shouldBuildForChanges('Dockerfile', null, changedFiles)).toBe(true)
    expect(shouldBuildForChanges('Dockerfile', [], changedFiles)).toBe(true)
  })

  test('should return true when changed file matches watch pattern', () => {
    const watchFiles = ['Dockerfile', 'package.json', 'src/**/*']
    const changedFiles: { filename: string }[] = [
      { filename: 'src/app.js' },
      { filename: 'README.md' },
    ]

    expect(shouldBuildForChanges('Dockerfile', watchFiles, changedFiles)).toBe(
      true,
    )
  })

  test('should return false when no changed files match watch patterns', () => {
    const watchFiles = ['Dockerfile', 'package.json']
    const changedFiles: { filename: string }[] = [
      { filename: 'README.md' },
      { filename: 'docs/guide.md' },
    ]

    expect(shouldBuildForChanges('Dockerfile', watchFiles, changedFiles)).toBe(
      false,
    )
  })

  test('should handle glob patterns correctly', () => {
    const watchFiles = ['src/**/*.js', '*.json']

    // Should match
    expect(
      shouldBuildForChanges('Dockerfile', watchFiles, [
        { filename: 'src/components/App.js' },
      ]),
    ).toBe(true)
    expect(
      shouldBuildForChanges('Dockerfile', watchFiles, [
        { filename: 'package.json' },
      ]),
    ).toBe(true)

    // Should not match
    expect(
      shouldBuildForChanges('Dockerfile', watchFiles, [
        { filename: 'src/styles.css' },
      ]),
    ).toBe(false)
    expect(
      shouldBuildForChanges('Dockerfile', watchFiles, [
        { filename: 'docs/package.json' },
      ]),
    ).toBe(false)
  })
})

describe('generateImageTag', () => {
  test('should generate tag with all components', () => {
    const argObj = {
      include_branch_name: true,
      include_timestamp: true,
      include_commit_sha: true,
    }

    const result = generateImageTag(argObj, 'main', 'UTC', 'abc123')
    expect(result).toMatch(/main-\d{12}-abc123/)
  })

  test('should generate tag with only branch name', () => {
    const argObj = {
      include_branch_name: true,
      include_timestamp: false,
      include_commit_sha: false,
    }

    const result = generateImageTag(argObj, 'develop', 'UTC', 'def456')
    expect(result).toBe('develop')
  })

  test('should generate empty tag when no components selected', () => {
    const argObj = {
      include_branch_name: false,
      include_timestamp: false,
      include_commit_sha: false,
    }

    const result = generateImageTag(argObj, 'main', 'UTC', 'abc123')
    expect(result).toBe('')
  })
})

describe('loadProjectConfig', () => {
  test('should return default config when file does not exist', () => {
    const config = loadProjectConfig('/nonexistent')
    expect(config).toEqual({
      imagetag_on_tag_pushed: ['{tag}'],
      imagetag_on_branch_pushed: ['{branch}-{timestamp}-{sha}', 'latest'],
      watch_files: [],
    })
  })

  test('should load config with watch_files from project file', () => {
    const configPath = join(testDir, 'smart-docker-build.yml')
    writeFileSync(
      configPath,
      `
imagetag_on_tag_pushed: ["{tag}"]
imagetag_on_branch_pushed: ["{branch}-{sha}", "latest"]
watch_files: ["package.json", "src/**/*"]
`,
    )

    const config = loadProjectConfig(testDir)
    expect(config).toEqual({
      imagetag_on_tag_pushed: ['{tag}'],
      imagetag_on_branch_pushed: ['{branch}-{sha}', 'latest'],
      watch_files: ['package.json', 'src/**/*'],
    })
  })
})

describe('extractImageNameFromDockerfile', () => {
  test('should return null for non-existent file', () => {
    const name = extractImageNameFromDockerfile('/nonexistent/Dockerfile')
    expect(name).toBeNull()
  })
})

describe('extractDockerfileConfig', () => {
  test('should return null values for non-existent file', () => {
    const config = extractDockerfileConfig('/nonexistent/Dockerfile')
    expect(config).toEqual({
      imageName: null,
      imagetagOnTagPushed: null,
      imagetagOnBranchPushed: null,
      watchFiles: null,
    })
  })

  test('should extract basic image name (legacy format)', () => {
    const dockerfilePath = join(testDir, 'Dockerfile')
    writeFileSync(
      dockerfilePath,
      `# Image: my-app
FROM node:18
WORKDIR /app`,
    )

    const config = extractDockerfileConfig(dockerfilePath)
    expect(config.imageName).toBe('my-app')
    expect(config.imagetagOnTagPushed).toBeNull()
    expect(config.imagetagOnBranchPushed).toBeNull()
    expect(config.watchFiles).toBeNull()
  })

  test('should extract image name (new format)', () => {
    const dockerfilePath = join(testDir, 'Dockerfile')
    writeFileSync(
      dockerfilePath,
      `# image: my-app
FROM node:18
WORKDIR /app`,
    )

    const config = extractDockerfileConfig(dockerfilePath)
    expect(config.imageName).toBe('my-app')
  })

  test('should extract tag configuration', () => {
    const dockerfilePath = join(testDir, 'Dockerfile')
    writeFileSync(
      dockerfilePath,
      `# image: dev-tools
# imagetag_on_tag_pushed: false
# imagetag_on_branch_pushed: ["dev-v1.0"]
FROM alpine:3.18
WORKDIR /app`,
    )

    const config = extractDockerfileConfig(dockerfilePath)
    expect(config.imageName).toBe('dev-tools')
    expect(config.imagetagOnTagPushed).toBe(false)
    expect(config.imagetagOnBranchPushed).toEqual(['dev-v1.0'])
  })

  test('should parse JSON array configuration', () => {
    const dockerfilePath = join(testDir, 'Dockerfile')
    writeFileSync(
      dockerfilePath,
      `# image: my-app
# imagetag_on_tag_pushed: ["{tag}", "latest", "stable"]
# imagetag_on_branch_pushed: ["{branch}-{sha}"]
FROM node:18`,
    )

    const config = extractDockerfileConfig(dockerfilePath)
    expect(config.imagetagOnTagPushed).toEqual(['{tag}', 'latest', 'stable'])
    expect(config.imagetagOnBranchPushed).toEqual(['{branch}-{sha}'])
  })

  test('should handle single string as array', () => {
    const dockerfilePath = join(testDir, 'Dockerfile')
    writeFileSync(
      dockerfilePath,
      `# image: my-app
# imagetag_on_tag_pushed: production
# imagetag_on_branch_pushed: dev-latest
FROM node:18`,
    )

    const config = extractDockerfileConfig(dockerfilePath)
    expect(config.imagetagOnTagPushed).toEqual(['production'])
    expect(config.imagetagOnBranchPushed).toEqual(['dev-latest'])
  })

  test('should extract watch_files configuration', () => {
    const dockerfilePath = join(testDir, 'Dockerfile')
    writeFileSync(
      dockerfilePath,
      `# image: my-devcontainer
# imagetag_on_tag_pushed: false
# imagetag_on_branch_pushed: ["v1.0"]
# watch_files: ["Dockerfile", ".devcontainer/**/*"]
FROM mcr.microsoft.com/devcontainers/base:ubuntu`,
    )

    const config = extractDockerfileConfig(dockerfilePath)
    expect(config.imageName).toBe('my-devcontainer')
    expect(config.imagetagOnTagPushed).toBe(false)
    expect(config.imagetagOnBranchPushed).toEqual(['v1.0'])
    expect(config.watchFiles).toEqual(['Dockerfile', '.devcontainer/**/*'])
  })

  test('should handle single watch_files string', () => {
    const dockerfilePath = join(testDir, 'Dockerfile')
    writeFileSync(
      dockerfilePath,
      `# image: my-app
# watch_files: Dockerfile
FROM node:18`,
    )

    const config = extractDockerfileConfig(dockerfilePath)
    expect(config.watchFiles).toEqual(['Dockerfile'])
  })
})

describe('validateTemplateVariables', () => {
  test('should pass when all variables are available', () => {
    const templates = ['{tag}', '{branch}-{sha}', '{timestamp}']
    const availableVariables = ['tag', 'branch', 'sha', 'timestamp']

    expect(() => {
      validateTemplateVariables(templates, availableVariables)
    }).not.toThrow()
  })

  test('should throw error when variable is missing', () => {
    const templates = ['{tag}', '{branch}-{missing}']
    const availableVariables = ['tag', 'branch', 'sha', 'timestamp']

    expect(() => {
      validateTemplateVariables(templates, availableVariables)
    }).toThrow('❌ Invalid template variables found: {missing}')
  })

  test('should throw error for multiple missing variables', () => {
    const templates = ['{tag}', '{unknown}-{missing}']
    const availableVariables = ['tag', 'branch', 'sha', 'timestamp']

    expect(() => {
      validateTemplateVariables(templates, availableVariables)
    }).toThrow('❌ Invalid template variables found: {unknown}, {missing}')
  })

  test('should not duplicate missing variables', () => {
    const templates = ['{missing}', '{missing}-{tag}']
    const availableVariables = ['tag', 'branch', 'sha', 'timestamp']

    expect(() => {
      validateTemplateVariables(templates, availableVariables)
    }).toThrow('❌ Invalid template variables found: {missing}')
  })
})

describe('generateTagsFromTemplates', () => {
  test('should generate tags from templates', () => {
    const templates = ['{tag}', '{branch}-{sha}']
    const variables = { tag: 'v1.0.0', branch: 'main', sha: 'abc1234' }

    const result = generateTagsFromTemplates(templates, variables)
    expect(result).toEqual(['v1.0.0', 'main-abc1234'])
  })

  test('should handle missing variables', () => {
    const templates = ['{tag}', '{branch}-{missing}']
    const variables = { tag: 'v1.0.0', branch: 'main' }

    const result = generateTagsFromTemplates(templates, variables)
    expect(result).toEqual(['v1.0.0', 'main-{missing}'])
  })
})

describe('createTemplateVariables', () => {
  test('should create template variables', () => {
    const variables = createTemplateVariables(
      'main',
      'v1.0.0',
      'UTC',
      'abc1234567',
    )

    expect(variables).toMatchObject({
      sha: 'abc1234',
      branch: 'main',
      tag: 'v1.0.0',
    })
    expect(variables.timestamp).toMatch(/^\d{12}$/)
  })

  test('should handle missing branch and tag', () => {
    const variables = createTemplateVariables(null, null, 'UTC', 'abc1234567')

    expect(variables).toMatchObject({
      sha: 'abc1234',
    })
    expect(variables.branch).toBeUndefined()
    expect(variables.tag).toBeUndefined()
  })
})

describe('checkImageTagExists', () => {
  test('should return false when API call fails', async () => {
    const mockOctokit = {
      request: async () => {
        throw new Error('API Error')
      },
    } as any

    const exists = await checkImageTagExists(
      mockOctokit,
      'owner',
      'my-app',
      'v1.0',
    )
    expect(exists).toBe(false)
  })

  test('should return true when tag exists', async () => {
    const mockOctokit = {
      request: async () => ({
        data: [
          {
            metadata: {
              container: {
                tags: ['v1.0', 'latest'],
              },
            },
          },
        ],
      }),
    } as any

    const exists = await checkImageTagExists(
      mockOctokit,
      'owner',
      'my-app',
      'v1.0',
    )
    expect(exists).toBe(true)
  })

  test('should return false when tag does not exist', async () => {
    const mockOctokit = {
      request: async () => ({
        data: [
          {
            metadata: {
              container: {
                tags: ['v2.0', 'latest'],
              },
            },
          },
        ],
      }),
    } as any

    const exists = await checkImageTagExists(
      mockOctokit,
      'owner',
      'my-app',
      'v1.0',
    )
    expect(exists).toBe(false)
  })
})

describe('validateTagsBeforeBuild', () => {
  test('should not throw when no tags exist', async () => {
    const mockOctokit = {
      request: async () => {
        throw new Error('Package not found')
      },
    } as any

    const templateVariables = { tag: 'v1.0', sha: 'abc1234' }

    await expect(
      validateTagsBeforeBuild(
        ['{tag}', 'latest'],
        templateVariables,
        mockOctokit,
        'owner',
        'my-app',
      ),
    ).resolves.not.toThrow()
  })

  test('should throw when tag already exists', async () => {
    const mockOctokit = {
      request: async () => ({
        data: [
          {
            metadata: {
              container: {
                tags: ['v1.0', 'latest'],
              },
            },
          },
        ],
      }),
    } as any

    const templateVariables = { tag: 'v1.0', sha: 'abc1234' }

    await expect(
      validateTagsBeforeBuild(
        ['{tag}'],
        templateVariables,
        mockOctokit,
        'owner',
        'my-app',
      ),
    ).rejects.toThrow("❌ Image tag 'my-app:v1.0' already exists in registry")
  })

  test('should validate all generated tags', async () => {
    const mockOctokit = {
      request: async () => ({
        data: [
          {
            metadata: {
              container: {
                tags: ['latest'], // Only latest exists
              },
            },
          },
        ],
      }),
    } as any

    const templateVariables = { tag: 'v1.0', sha: 'abc1234' }

    await expect(
      validateTagsBeforeBuild(
        ['{tag}', 'latest'], // v1.0 doesn't exist, but latest does
        templateVariables,
        mockOctokit,
        'owner',
        'my-app',
      ),
    ).rejects.toThrow("❌ Image tag 'my-app:latest' already exists in registry")
  })
})
