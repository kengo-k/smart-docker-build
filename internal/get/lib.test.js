import { afterEach, beforeEach, describe, expect, test } from '@jest/globals'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

import {
  generateImageTag,
  parseArgs,
  parseGitRef,
  shouldBuildForChanges,
  validateAndParseConfigurations,
  validateDockerfile,
  validateInputs,
} from './lib.js'

// Test fixture setup
const testDir = join(process.cwd(), 'test-fixtures')

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('validateInputs', () => {
  test('should pass with valid inputs', () => {
    expect(() => {
      validateInputs('token123', 'UTC', [{ path: 'Dockerfile', name: 'test' }])
    }).not.toThrow()
  })

  test('should throw error for empty token', () => {
    expect(() => {
      validateInputs('', 'UTC', [{ path: 'Dockerfile', name: 'test' }])
    }).toThrow('Token is required')
  })

  test('should throw error for empty timezone', () => {
    expect(() => {
      validateInputs('token123', '', [{ path: 'Dockerfile', name: 'test' }])
    }).toThrow('Timezone is required')
  })

  test('should throw error for empty args', () => {
    expect(() => {
      validateInputs('token123', 'UTC', [])
    }).toThrow('Args must be a non-empty array')
  })
})

describe('validateDockerfile', () => {
  test('should pass when Dockerfile exists', () => {
    const dockerfilePath = join(testDir, 'Dockerfile')
    writeFileSync(dockerfilePath, 'FROM node:18')

    expect(() => {
      validateDockerfile('Dockerfile', testDir)
    }).not.toThrow()
  })

  test('should throw error when Dockerfile does not exist', () => {
    expect(() => {
      validateDockerfile('NonexistentDockerfile', testDir)
    }).toThrow('Dockerfile not found')
  })
})

describe('parseArgs', () => {
  test('should parse valid YAML', () => {
    const yamlString = `
- path: Dockerfile
  name: test-app
  on_branch_pushed: true
`
    const result = parseArgs(yamlString)
    expect(result).toEqual([
      {
        path: 'Dockerfile',
        name: 'test-app',
        on_branch_pushed: true,
      },
    ])
  })

  test('should throw error for invalid YAML', () => {
    const invalidYaml =
      '- path: Dockerfile\n  name: test-app\n    invalid: indentation'
    expect(() => {
      parseArgs(invalidYaml)
    }).toThrow('Failed to parse YAML')
  })
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
    const changedFiles = []

    expect(shouldBuildForChanges(argObj, changedFiles)).toBe(true)
  })

  test('should return true when Dockerfile is in changed files', () => {
    const argObj = { on_branch_changed: true, path: 'Dockerfile' }
    const changedFiles = [
      { filename: 'Dockerfile' },
      { filename: 'src/app.js' },
    ]

    expect(shouldBuildForChanges(argObj, changedFiles)).toBe(true)
  })

  test('should return false when Dockerfile is not changed', () => {
    const argObj = { on_branch_changed: true, path: 'Dockerfile' }
    const changedFiles = [{ filename: 'src/app.js' }, { filename: 'README.md' }]

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

describe('validateAndParseConfigurations', () => {
  beforeEach(() => {
    // Create test Dockerfiles
    writeFileSync(join(testDir, 'Dockerfile'), 'FROM node:18')
    writeFileSync(join(testDir, 'api.dockerfile'), 'FROM python:3.9')
  })

  test('should validate and parse valid configurations', () => {
    const args = [
      { path: 'Dockerfile', name: 'test-app' },
      { path: 'api.dockerfile', name: 'test-api' },
    ]

    // Mock process.cwd to return testDir
    const originalCwd = process.cwd
    process.cwd = () => testDir

    try {
      const result = validateAndParseConfigurations(args)
      expect(result.validConfigurations).toHaveLength(2)
      expect(result.validationErrors).toHaveLength(0)
    } finally {
      process.cwd = originalCwd
    }
  })

  test('should handle invalid configurations gracefully', () => {
    const args = [
      { path: 'NonexistentDockerfile', name: 'invalid-app' },
      { path: 'Dockerfile', name: 'valid-app' },
    ]

    const originalCwd = process.cwd
    process.cwd = () => testDir

    try {
      const result = validateAndParseConfigurations(args)
      expect(result.validConfigurations).toHaveLength(1)
      expect(result.validationErrors).toHaveLength(1)
      expect(result.validationErrors[0]).toContain('Dockerfile not found')
    } finally {
      process.cwd = originalCwd
    }
  })
})
