import { getInput, info, setFailed, setOutput, warning } from '@actions/core'
import github from '@actions/github'

import { generateBuildArgsNew, generateBuildArgs } from './lib.js'

async function main() {
  info('🔍 Smart Docker Build - Processing inputs...')

  const token = getInput('token')
  const timezone = getInput('timezone')
  
  // New input parameters
  const tagsYaml = getInput('tags')
  const buildYaml = getInput('build')
  const imagesYaml = getInput('images')
  
  // Legacy parameter
  const argsYaml = getInput('args')

  try {
    let result

    if (argsYaml) {
      // Use legacy function for backward compatibility
      info('📦 Using legacy args configuration')
      result = await generateBuildArgs(token, timezone, argsYaml, github.context)
    } else {
      // Use new smart detection
      info('🚀 Using smart Dockerfile detection')
      result = await generateBuildArgsNew(
        token,
        timezone,
        tagsYaml,
        buildYaml,
        imagesYaml,
        github.context
      )
    }

    const { buildArgs, validationErrors } = result

    // Log validation errors as warnings
    if (validationErrors.length > 0) {
      warning(
        `⚠️ Some configurations were skipped due to validation errors:\n${validationErrors.join('\n')}`,
      )
    }

    if (buildArgs.length === 0) {
      info('ℹ️ No images to build based on current configuration and changes')
    } else {
      info(`✅ Successfully generated ${buildArgs.length} build configurations`)
      
      // Log results for debugging
      console.log('Build arguments:', buildArgs)
    }

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
