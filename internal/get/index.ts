import { getInput, info, setFailed, setOutput } from '@actions/core'
import github from '@actions/github'

import { generateBuildArgs } from './lib.js'

async function main(): Promise<void> {
  const token = getInput('token')
  const timezone = getInput('timezone')

  const { buildArgs, validationErrors } = await generateBuildArgs(
    token,
    timezone,
    github.context,
    process.env.GITHUB_WORKSPACE!,
  )

  // Handle validation errors as failures
  if (validationErrors.length > 0) {
    setFailed(`❌ Validation errors found:\n${validationErrors.join('\n')}`)
    return
  }

  if (buildArgs.length === 0) {
    info('ℹ️ No images to build based on current configuration and changes')
    setOutput('build_args', JSON.stringify([]))
    setOutput('has_builds', 'false')
    return
  }

  info(`✅ Successfully generated ${buildArgs.length} build configurations`)
  setOutput('build_args', JSON.stringify(buildArgs))
  setOutput('has_builds', 'true')
}

try {
  await main()
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error))
}
