import { getInput, info, setFailed, setOutput, warning, } from '@actions/core';
import github from '@actions/github';
import { generateBuildArgs } from './lib.js';
async function main() {
    info('🔍 Smart Docker Build - Processing inputs...');
    const token = getInput('token');
    const timezone = getInput('timezone');
    const cacheEnabled = getInput('cache_enabled');
    const cacheType = getInput('cache_type');
    try {
        const { buildArgs, validationErrors } = await generateBuildArgs(token, timezone, github.context, process.env.GITHUB_WORKSPACE);
        // Log validation errors as warnings
        if (validationErrors.length > 0) {
            warning(`⚠️ Some configurations were skipped due to validation errors:\n${validationErrors.join('\n')}`);
        }
        if (buildArgs.length === 0) {
            info('ℹ️ No images to build based on current configuration and changes');
        }
        else {
            info(`✅ Successfully generated ${buildArgs.length} build configurations`);
        }
        setOutput('build_args', JSON.stringify(buildArgs));
    }
    catch (error) {
        throw error;
    }
}
try {
    await main();
}
catch (error) {
    setFailed(error instanceof Error ? error.message : String(error));
}
