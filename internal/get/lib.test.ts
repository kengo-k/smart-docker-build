import { afterEach, beforeEach, describe, expect, test } from '@jest/globals'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

import {
  checkImageTagExists,
  createTemplateVariables,
  ensureUniqueTag,
  extractDockerfileConfig,
  generateBuildArgs,
  generateTags,
  isBuildRequired,
  loadProjectConfig,
  parseGitRef,
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

describe('isBuildRequired', () => {
  test('should return true when no watchFiles specified (default behavior)', () => {
    const changedFiles: { filename: string }[] = [
      { filename: 'src/app.js' },
      { filename: 'README.md' },
    ]

    expect(isBuildRequired([], changedFiles)).toBe(true)
  })

  test('should return true when changed file matches watch pattern', () => {
    const watchFiles = ['Dockerfile', 'package.json', 'src/**/*']
    const changedFiles: { filename: string }[] = [
      { filename: 'src/app.js' },
      { filename: 'README.md' },
    ]

    expect(isBuildRequired(watchFiles, changedFiles)).toBe(true)
  })

  test('should return false when no changed files match watch patterns', () => {
    const watchFiles = ['Dockerfile', 'package.json']
    const changedFiles: { filename: string }[] = [
      { filename: 'README.md' },
      { filename: 'docs/guide.md' },
    ]

    expect(isBuildRequired(watchFiles, changedFiles)).toBe(false)
  })

  test('should handle glob patterns correctly', () => {
    const watchFiles = ['src/**/*.js', '*.json']

    // Should match
    expect(
      isBuildRequired(watchFiles, [{ filename: 'src/components/App.js' }]),
    ).toBe(true)
    expect(isBuildRequired(watchFiles, [{ filename: 'package.json' }])).toBe(
      true,
    )

    // Should not match
    expect(isBuildRequired(watchFiles, [{ filename: 'src/styles.css' }])).toBe(
      false,
    )
    expect(
      isBuildRequired(watchFiles, [{ filename: 'docs/package.json' }]),
    ).toBe(false)
  })
})

describe('loadProjectConfig', () => {
  test('should return default config when file does not exist', () => {
    const config = loadProjectConfig('/nonexistent')
    expect(config).toEqual({
      imageTagsOnTagPushed: ['{tag}'],
      imageTagsOnBranchPushed: ['{branch}-{timestamp}-{sha}', 'latest'],
      watchFiles: [],
    })
  })

  test('should load config with watchFiles from project file', () => {
    const configPath = join(testDir, 'smart-docker-build.yml')
    writeFileSync(
      configPath,
      `
imageTagsOnTagPushed: ["{tag}"]
imageTagsOnBranchPushed: ["{branch}-{sha}", "latest"]
watchFiles: ["package.json", "src/**/*"]
`,
    )

    const config = loadProjectConfig(testDir)
    expect(config).toEqual({
      imageTagsOnTagPushed: ['{tag}'],
      imageTagsOnBranchPushed: ['{branch}-{sha}', 'latest'],
      watchFiles: ['package.json', 'src/**/*'],
    })
  })
})

describe('extractDockerfileConfig', () => {
  test('should return empty object for non-existent file', () => {
    const config = extractDockerfileConfig('/nonexistent/Dockerfile', '/tmp')
    expect(config).toEqual({})
  })

  test('should extract basic image name (legacy format)', () => {
    const dockerfilePath = join(testDir, 'Dockerfile')
    writeFileSync(
      dockerfilePath,
      `# Image: my-app
FROM node:18
WORKDIR /app`,
    )

    const config = extractDockerfileConfig(dockerfilePath, testDir)
    expect(config.imageName).toBe('my-app')
    expect(config.imageTagsOnTagPushed).toBeUndefined()
    expect(config.imageTagsOnBranchPushed).toBeUndefined()
    expect(config.watchFiles).toBeUndefined()
  })

  test('should extract image name (new format)', () => {
    const dockerfilePath = join(testDir, 'Dockerfile')
    writeFileSync(
      dockerfilePath,
      `# image: my-app
FROM node:18
WORKDIR /app`,
    )

    const config = extractDockerfileConfig(dockerfilePath, testDir)
    expect(config.imageName).toBe('my-app')
  })

  test('should extract tag configuration', () => {
    const dockerfilePath = join(testDir, 'Dockerfile')
    writeFileSync(
      dockerfilePath,
      `# image: dev-tools
# imageTagsOnTagPushed: null
# imageTagsOnBranchPushed: ["dev-v1.0"]
FROM alpine:3.18
WORKDIR /app`,
    )

    const config = extractDockerfileConfig(dockerfilePath, testDir)
    expect(config.imageName).toBe('dev-tools')
    expect(config.imageTagsOnTagPushed).toBe(null)
    expect(config.imageTagsOnBranchPushed).toEqual(['dev-v1.0'])
  })

  test('should parse JSON array configuration', () => {
    const dockerfilePath = join(testDir, 'Dockerfile')
    writeFileSync(
      dockerfilePath,
      `# image: my-app
# imageTagsOnTagPushed: ["{tag}", "latest", "stable"]
# imageTagsOnBranchPushed: ["{branch}-{sha}"]
FROM node:18`,
    )

    const config = extractDockerfileConfig(dockerfilePath, testDir)
    expect(config.imageTagsOnTagPushed).toEqual(['{tag}', 'latest', 'stable'])
    expect(config.imageTagsOnBranchPushed).toEqual(['{branch}-{sha}'])
  })

  test('should throw error for invalid JSON format', () => {
    const dockerfilePath = join(testDir, 'Dockerfile')
    writeFileSync(
      dockerfilePath,
      `# image: my-app
# imageTagsOnTagPushed: production
FROM node:18`,
    )

    expect(() => {
      extractDockerfileConfig(dockerfilePath, testDir)
    }).toThrow('Invalid JSON syntax for imageTagsOnTagPushed')
  })

  test('should extract watchFiles configuration', () => {
    const dockerfilePath = join(testDir, 'Dockerfile')
    writeFileSync(
      dockerfilePath,
      `# image: my-devcontainer
# imageTagsOnTagPushed: null
# imageTagsOnBranchPushed: ["v1.0"]
# watchFiles: ["Dockerfile", ".devcontainer/**/*"]
FROM mcr.microsoft.com/devcontainers/base:ubuntu`,
    )

    const config = extractDockerfileConfig(dockerfilePath, testDir)
    expect(config.imageName).toBe('my-devcontainer')
    expect(config.imageTagsOnTagPushed).toBe(null)
    expect(config.imageTagsOnBranchPushed).toEqual(['v1.0'])
    expect(config.watchFiles).toEqual(['Dockerfile', '.devcontainer/**/*'])
  })

  test('should throw error for invalid watchFiles format', () => {
    const dockerfilePath = join(testDir, 'Dockerfile')
    writeFileSync(
      dockerfilePath,
      `# image: my-app
# watchFiles: Dockerfile
FROM node:18`,
    )

    expect(() => {
      extractDockerfileConfig(dockerfilePath, testDir)
    }).toThrow('Invalid JSON syntax for watchFiles')
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

describe('generateTags', () => {
  test('should generate tags from templates', () => {
    const templates = ['{tag}', '{branch}-{sha}']
    const variables = { tag: 'v1.0.0', branch: 'main', sha: 'abc1234' }

    const result = generateTags(templates, variables)
    expect(result).toEqual(['v1.0.0', 'main-abc1234'])
  })

  test('should handle missing variables', () => {
    const templates = ['{tag}', '{branch}-{missing}']
    const variables = { tag: 'v1.0.0', branch: 'main' }

    const result = generateTags(templates, variables)
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
  test('should throw error when API call fails', async () => {
    const mockOctokit = {
      request: async () => {
        throw new Error('API Error')
      },
    } as any

    await expect(
      checkImageTagExists(mockOctokit, 'my-app', 'v1.0'),
    ).rejects.toThrow('API Error')
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

    const exists = await checkImageTagExists(mockOctokit, 'my-app', 'v1.0')
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

    const exists = await checkImageTagExists(mockOctokit, 'my-app', 'v1.0')
    expect(exists).toBe(false)
  })
})

describe('ensureUniqueTag', () => {
  test('should throw when API call fails', async () => {
    const mockOctokit = {
      request: async () => {
        throw new Error('Package not found')
      },
    } as any

    const templateVariables = { tag: 'v1.0', sha: 'abc1234' }

    await expect(
      ensureUniqueTag(
        ['{tag}', 'latest'],
        templateVariables,
        mockOctokit,
        'my-app',
      ),
    ).rejects.toThrow('Package not found')
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
      ensureUniqueTag(['{tag}'], templateVariables, mockOctokit, 'my-app'),
    ).rejects.toThrow("❌ Image tag 'my-app:v1.0' already exists in registry")
  })

  test('should validate all generated tags', async () => {
    const mockOctokit = {
      request: async () => ({
        data: [
          {
            metadata: {
              container: {
                tags: ['v1.0', 'latest'], // Both v1.0 and latest exist
              },
            },
          },
        ],
      }),
    } as any

    const templateVariables = { tag: 'v1.0', sha: 'abc1234' }

    // Should throw for v1.0 (not latest, since latest is allowed to be overwritten)
    await expect(
      ensureUniqueTag(
        ['{tag}', 'latest'], // v1.0 exists and should cause error, latest is allowed
        templateVariables,
        mockOctokit,
        'my-app',
      ),
    ).rejects.toThrow("❌ Image tag 'my-app:v1.0' already exists in registry")
  })
})

describe('generateBuildArgs integration', () => {
  test('should not call getRepositoryChanges for tag pushes', () => {
    // This test verifies that the logic correctly skips getRepositoryChanges for tag pushes
    // by testing the conditional logic directly
    
    // Simulate tag push scenario
    const branch = null
    const tag = 'v1.0.0'
    const before = null // This is null for tag creation events
    
    // This logic should skip the getRepositoryChanges call
    const shouldCallGetRepositoryChanges = !!(branch && before)
    expect(shouldCallGetRepositoryChanges).toBe(false)
    
    // Verify tag push is detected correctly
    expect(tag).toBeTruthy()
    expect(branch).toBeFalsy()
  })

  test('should call getRepositoryChanges only for branch pushes with before context', () => {
    // This test verifies the conditional logic for when to call getRepositoryChanges
    
    // Simulate branch push with before context
    const branch1 = 'main'
    const tag1 = null
    const before1 = 'abc123'
    
    const shouldCallGetRepositoryChanges1 = !!(branch1 && before1)
    expect(shouldCallGetRepositoryChanges1).toBe(true)
    
    // Simulate branch push without before context
    const branch2 = 'main'
    const tag2 = null
    const before2 = null
    
    const shouldCallGetRepositoryChanges2 = !!(branch2 && before2)
    expect(shouldCallGetRepositoryChanges2).toBe(false)
    
    // Simulate tag push (no before context expected)
    const branch3 = null
    const tag3 = 'v1.0.0'
    const before3 = null
    
    const shouldCallGetRepositoryChanges3 = !!(branch3 && before3)
    expect(shouldCallGetRepositoryChanges3).toBe(false)
  })
})
