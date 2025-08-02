import { getInput, setFailed, setOutput } from '@actions/core'
import github from '@actions/github'

import { generateBuildArgs } from './lib.js'

async function main(): Promise<void> {
  console.log('⭐ js action `internal/get` started')
  const token = getInput('token')
  const timezone = getInput('timezone')

  const buildArgs = await generateBuildArgs(
    token,
    timezone,
    github.context,
    process.env.GITHUB_WORKSPACE!,
  )

  if (buildArgs.length === 0) {
    console.log(
      'ℹ️ No images to build based on current configuration and changes',
    )
    setOutput('build_args', JSON.stringify([]))
    setOutput('has_builds', 'false')
    return
  }

  console.log(`✅ Found ${buildArgs.length} build targets`)
  setOutput('build_args', JSON.stringify(buildArgs))
  setOutput('has_builds', 'true')
}

try {
  await main()
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error))
}
