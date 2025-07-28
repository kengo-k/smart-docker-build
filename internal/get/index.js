import { getInput, info, setFailed, setOutput, warning } from '@actions/core'
import github from '@actions/github'

import { generateBuildArgs } from './lib.js'

async function main() {
  info('🔍 Validating inputs...')
  
  const token = getInput('token')
  const timezone = getInput('timezone')
  const argsYaml = getInput('args')

  try {
    const { buildArgs, validationErrors } = await generateBuildArgs(
      token, 
      timezone, 
      argsYaml, 
      github.context
    )

    // Log validation errors as warnings
    if (validationErrors.length > 0) {
      warning(`⚠️ Some configurations were skipped due to validation errors:\n${validationErrors.join('\n')}`)
    }

    info(`✅ Successfully generated ${buildArgs.length} build configurations`)
    
    // Log results for debugging
    console.log('Build arguments:', buildArgs)

    setOutput('build_args', JSON.stringify(buildArgs))
  } catch (error) {
    throw error
  }
}

try {
  await main()
} catch (error) {
  setFailed(error.message)
}