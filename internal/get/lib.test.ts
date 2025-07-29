import { afterEach, beforeEach, describe, expect, test } from '@jest/globals'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'

import {
  createTemplateVariables,
  extractImageNameFromDockerfile,
  generateImageTag,
  generateTagsFromTemplates,
  loadProjectConfig,
  parseGitRef,
  shouldBuildForChanges,
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
  test('should return true when on_branch_changed is false', () => {
    const argObj = { on_branch_changed: false, path: 'Dockerfile' }
    const changedFiles: { filename: string }[] = []

    expect(shouldBuildForChanges(argObj, changedFiles)).toBe(true)
  })

  test('should return true when Dockerfile is in changed files', () => {
    const argObj = { on_branch_changed: true, path: 'Dockerfile' }
    const changedFiles: { filename: string }[] = [
      { filename: 'Dockerfile' },
      { filename: 'src/app.js' },
    ]

    expect(shouldBuildForChanges(argObj, changedFiles)).toBe(true)
  })

  test('should return false when Dockerfile is not changed', () => {
    const argObj = { on_branch_changed: true, path: 'Dockerfile' }
    const changedFiles: { filename: string }[] = [
      { filename: 'src/app.js' },
      { filename: 'README.md' },
    ]

    expect(shouldBuildForChanges(argObj, changedFiles)).toBe(false)
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
      tags: {
        tag_pushed: ['{tag}'],
        branch_pushed: ['{branch}-{timestamp}-{sha}'],
      },
      build: {
        on_branch_push: true,
        on_tag_push: true,
      },
    })
  })
})

describe('extractImageNameFromDockerfile', () => {
  test('should return null for non-existent file', () => {
    const name = extractImageNameFromDockerfile('/nonexistent/Dockerfile')
    expect(name).toBeNull()
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
      'my-repo',
    )

    expect(variables).toMatchObject({
      sha: 'abc1234',
      branch: 'main',
      tag: 'v1.0.0',
    })
    expect(variables.timestamp).toMatch(/^\d{12}$/)
  })

  test('should handle missing branch and tag', () => {
    const variables = createTemplateVariables(
      null,
      null,
      'UTC',
      'abc1234567',
      'my-repo',
    )

    expect(variables).toMatchObject({
      sha: 'abc1234',
    })
    expect(variables.branch).toBeUndefined()
    expect(variables.tag).toBeUndefined()
  })
})
