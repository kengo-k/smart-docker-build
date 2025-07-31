import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { existsSync, readFileSync } from 'fs';
import { readdir } from 'fs/promises';
import { load } from 'js-yaml';
import { resolve } from 'path';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';
// Default configuration
const DEFAULT_CONFIG = {
    imagetag_on_tag_pushed: ['{tag}'],
    imagetag_on_branch_pushed: ['{branch}-{timestamp}-{sha}', 'latest'],
    watch_files: [], // Empty by default - means always build
};
// Configuration schemas
const tagConfigSchema = z.union([z.literal(false), z.array(z.string())]);
const configSchema = z.object({
    imagetag_on_tag_pushed: tagConfigSchema.optional().default(['{tag}']),
    imagetag_on_branch_pushed: tagConfigSchema
        .optional()
        .default(['{branch}-{timestamp}-{sha}', 'latest']),
    watch_files: z.array(z.string()).optional().default([]),
});
// Generate build arguments with smart detection
export async function generateBuildArgs(token, timezone, githubContext, workingDir) {
    // Validate token
    if (!token || token.trim() === '') {
        throw new Error('❌ Token is required but not provided');
    }
    // Load configuration from project file only
    const projectConfig = loadProjectConfig(workingDir);
    // Validate template variables in tag configuration
    const availableVariables = ['tag', 'branch', 'sha', 'timestamp'];
    if (Array.isArray(projectConfig.imagetag_on_tag_pushed)) {
        validateTemplateVariables(projectConfig.imagetag_on_tag_pushed, availableVariables);
    }
    if (Array.isArray(projectConfig.imagetag_on_branch_pushed)) {
        validateTemplateVariables(projectConfig.imagetag_on_branch_pushed, availableVariables);
    }
    // Get repository information
    const octokit = new Octokit({ auth: token });
    const { repository, after, ref } = githubContext.payload;
    if (!repository || !after || !ref) {
        throw new Error('❌ Missing required GitHub context information (repository, after, ref)');
    }
    const { branch, tag } = parseGitRef(ref);
    // Get repository changes for change detection
    const compare = await getRepositoryChanges(octokit, repository, after);
    const changedFiles = compare.data.files || [];
    // Auto-detect Dockerfiles and determine images to build
    const dockerfiles = await findDockerfiles(workingDir);
    if (dockerfiles.length === 0) {
        throw new Error('❌ No Dockerfiles found in the repository');
    }
    const imagesToProcess = [];
    if (dockerfiles.length === 1) {
        // Single Dockerfile: check for image name comment first
        const dockerfileConfig = extractDockerfileConfig(dockerfiles[0], workingDir);
        imagesToProcess.push({
            dockerfile: dockerfiles[0],
            name: dockerfileConfig.imageName || repository.name, // Use repository name as fallback
            dockerfileConfig,
        });
    }
    else {
        // Multiple Dockerfiles: require image names
        for (const dockerfilePath of dockerfiles) {
            const dockerfileConfig = extractDockerfileConfig(dockerfilePath, workingDir);
            if (!dockerfileConfig.imageName) {
                throw new Error(`❌ Multiple Dockerfiles found but no image name specified for ${dockerfilePath}\n` +
                    `💡 Solutions:\n` +
                    `   - Add comment: # image: my-image-name\n` +
                    `   - Create smart-docker-build.yml with explicit image configurations`);
            }
            imagesToProcess.push({
                dockerfile: dockerfilePath,
                name: dockerfileConfig.imageName,
                dockerfileConfig,
            });
        }
    }
    // Generate build arguments based on git event
    const outputs = [];
    const templateVariables = createTemplateVariables(branch, tag, timezone, after);
    for (const image of imagesToProcess) {
        // Get effective configuration (Dockerfile config overrides project config)
        const effectiveTagPushedConfig = image.dockerfileConfig.imagetagOnTagPushed !== null
            ? image.dockerfileConfig.imagetagOnTagPushed
            : projectConfig.imagetag_on_tag_pushed;
        const effectiveBranchPushedConfig = image.dockerfileConfig.imagetagOnBranchPushed !== null
            ? image.dockerfileConfig.imagetagOnBranchPushed
            : projectConfig.imagetag_on_branch_pushed;
        // Check build conditions
        if (tag && Array.isArray(effectiveTagPushedConfig)) {
            // Tag push: validate tags don't exist, then build
            await validateTagsBeforeBuild(effectiveTagPushedConfig, templateVariables, octokit, repository.owner.login, image.name);
            const tags = generateTagsFromTemplates(effectiveTagPushedConfig, templateVariables);
            for (const tagName of tags) {
                outputs.push({
                    path: image.dockerfile,
                    name: image.name,
                    tag: tagName,
                });
            }
        }
        else if (branch && Array.isArray(effectiveBranchPushedConfig)) {
            // Branch push: check for changes using watch_files (Dockerfile config overrides project config)
            const effectiveWatchFiles = image.dockerfileConfig.watchFiles !== null
                ? image.dockerfileConfig.watchFiles
                : projectConfig.watch_files;
            const hasChanges = shouldBuildForChanges(image.dockerfile, effectiveWatchFiles, changedFiles);
            if (hasChanges) {
                // Validate tags don't exist, then build
                await validateTagsBeforeBuild(effectiveBranchPushedConfig, templateVariables, octokit, repository.owner.login, image.name);
                const tags = generateTagsFromTemplates(effectiveBranchPushedConfig, templateVariables);
                for (const tagName of tags) {
                    outputs.push({
                        path: image.dockerfile,
                        name: image.name,
                        tag: tagName,
                    });
                }
            }
        }
    }
    return {
        buildArgs: outputs,
        validationErrors: [],
    };
}
// Load project configuration
export function loadProjectConfig(workingDir) {
    const configPath = resolve(workingDir, 'smart-docker-build.yml');
    if (existsSync(configPath)) {
        try {
            const configContent = readFileSync(configPath, 'utf8');
            const rawConfig = load(configContent);
            return configSchema.parse(rawConfig);
        }
        catch (error) {
            throw new Error(`❌ Failed to parse config file ${configPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    return DEFAULT_CONFIG;
}
// Find all Dockerfiles in the project
export async function findDockerfiles(workingDir) {
    const dockerfiles = [];
    async function searchDir(dir) {
        try {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = resolve(dir, entry.name);
                if (entry.isDirectory()) {
                    // Skip common directories we don't want to search
                    if (!['node_modules', '.git', '.github', 'dist', 'build'].includes(entry.name)) {
                        await searchDir(fullPath);
                    }
                }
                else if (entry.name === 'Dockerfile' ||
                    entry.name.startsWith('Dockerfile.')) {
                    const relativePath = fullPath.replace(workingDir + '/', '');
                    dockerfiles.push(relativePath);
                }
            }
        }
        catch (error) {
            // Ignore directories we can't read
        }
    }
    await searchDir(workingDir);
    return dockerfiles;
}
export function extractDockerfileConfig(dockerfilePath, workingDir) {
    const absolutePath = resolve(workingDir, dockerfilePath);
    const result = {
        imageName: null,
        imagetagOnTagPushed: null,
        imagetagOnBranchPushed: null,
        watchFiles: null,
    };
    if (!existsSync(absolutePath)) {
        return result;
    }
    try {
        const content = readFileSync(absolutePath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines.slice(0, 10)) {
            // Check first 10 lines
            // Support both "Image:" and "image:" (case insensitive)
            const imageMatch = line.match(/^#\s*[Ii]mage:\s*(.+)$/);
            if (imageMatch) {
                result.imageName = imageMatch[1].trim();
                continue;
            }
            // imagetag_on_tag_pushed configuration
            const tagPushedMatch = line.match(/^#\s*imagetag_on_tag_pushed:\s*(.+)$/);
            if (tagPushedMatch) {
                const value = tagPushedMatch[1].trim();
                if (value === 'false') {
                    result.imagetagOnTagPushed = false;
                }
                else {
                    try {
                        // Parse as JSON array
                        const parsed = JSON.parse(value);
                        if (Array.isArray(parsed)) {
                            result.imagetagOnTagPushed = parsed;
                        }
                    }
                    catch {
                        // If not valid JSON, treat as single string
                        result.imagetagOnTagPushed = [value];
                    }
                }
                continue;
            }
            // imagetag_on_branch_pushed configuration
            const branchPushedMatch = line.match(/^#\s*imagetag_on_branch_pushed:\s*(.+)$/);
            if (branchPushedMatch) {
                const value = branchPushedMatch[1].trim();
                if (value === 'false') {
                    result.imagetagOnBranchPushed = false;
                }
                else {
                    try {
                        // Parse as JSON array
                        const parsed = JSON.parse(value);
                        if (Array.isArray(parsed)) {
                            result.imagetagOnBranchPushed = parsed;
                        }
                    }
                    catch {
                        // If not valid JSON, treat as single string
                        result.imagetagOnBranchPushed = [value];
                    }
                }
                continue;
            }
            // watch_files configuration
            const watchFilesMatch = line.match(/^#\s*watch_files:\s*(.+)$/);
            if (watchFilesMatch) {
                const value = watchFilesMatch[1].trim();
                try {
                    // Parse as JSON array
                    const parsed = JSON.parse(value);
                    if (Array.isArray(parsed)) {
                        result.watchFiles = parsed;
                    }
                }
                catch {
                    // If not valid JSON, treat as single string
                    result.watchFiles = [value];
                }
                continue;
            }
        }
    }
    catch (error) {
        // Ignore read errors
    }
    return result;
}
// Legacy function for backward compatibility
export function extractImageNameFromDockerfile(dockerfilePath, workingDir) {
    return extractDockerfileConfig(dockerfilePath, workingDir).imageName;
}
export async function getRepositoryChanges(octokit, repository, after) {
    return await octokit.repos.compareCommits({
        owner: repository.owner.login,
        repo: repository.name,
        base: after + '^',
        head: after,
    });
}
// Check if image tag exists in GitHub Container Registry
export async function checkImageTagExists(octokit, owner, imageName, tag) {
    try {
        // GitHub Container Registry API
        // Extract the package name from the full image name (e.g., "owner/my-app" -> "my-app")
        const packageName = imageName.includes('/')
            ? imageName.split('/').pop()
            : imageName;
        const response = await octokit.request('GET /user/packages/container/{package_name}/versions', {
            package_name: packageName,
        });
        // Check if any version has the specified tag
        return response.data.some((version) => version.metadata?.container?.tags?.includes(tag));
    }
    catch (error) {
        // If we can't access the registry or package doesn't exist, assume tag doesn't exist
        return false;
    }
}
// Validate that image tags don't already exist in registry
export async function validateTagsBeforeBuild(tags, templateVariables, octokit, owner, imageName) {
    // Generate final tags from templates
    const finalTags = generateTagsFromTemplates(tags, templateVariables);
    // Check each tag for existence (skip 'latest' as it's meant to be overwritten)
    for (const tag of finalTags) {
        if (tag === 'latest') {
            continue; // Allow overwriting 'latest' tag
        }
        const exists = await checkImageTagExists(octokit, owner, imageName, tag);
        if (exists) {
            throw new Error(`❌ Image tag '${imageName}:${tag}' already exists in registry\n` +
                `💡 Solutions:\n` +
                `   - Update tag in Dockerfile comment\n` +
                `   - Use unique variables like {timestamp} or {sha}\n` +
                `   - Consider using force_overwrite flag if intentional overwrite is needed`);
        }
    }
}
export function parseGitRef(ref) {
    let branch = null;
    let tag = null;
    if (ref.startsWith('refs/heads/')) {
        branch = ref.replace('refs/heads/', '');
    }
    else if (ref.startsWith('refs/tags/')) {
        tag = ref.replace('refs/tags/', '');
    }
    else {
        throw new Error(`Unsupported ref: ${ref}`);
    }
    return { branch, tag };
}
// Simple glob pattern matching (basic implementation)
function matchesPattern(filename, pattern) {
    // Very basic implementation for common patterns
    if (pattern === filename)
        return true;
    // Handle simple * pattern (matches anything)
    if (pattern === '*')
        return true;
    // Handle *.extension pattern (only at root level, no subdirectories)
    if (pattern.startsWith('*.')) {
        const extension = pattern.slice(2);
        return filename.endsWith('.' + extension) && !filename.includes('/');
    }
    // Handle src/**/*.js pattern (recursive directory match with extension)
    if (pattern.includes('**/*')) {
        const parts = pattern.split('**/');
        const prefix = parts[0]; // e.g., "src/"
        const suffix = parts[1]; // e.g., "*.js"
        if (!filename.startsWith(prefix))
            return false;
        if (suffix === '*')
            return true;
        // Handle *.extension after **
        if (suffix.startsWith('*.')) {
            const extension = suffix.slice(2);
            return filename.endsWith('.' + extension);
        }
        return filename.endsWith(suffix);
    }
    // Handle src/* pattern (single directory match)
    if (pattern.includes('/*') && !pattern.includes('**')) {
        const prefix = pattern.split('/*')[0] + '/';
        const suffix = pattern.split('/*')[1];
        const afterPrefix = filename.slice(prefix.length);
        return (filename.startsWith(prefix) &&
            !afterPrefix.includes('/') &&
            (suffix === '*' || afterPrefix.endsWith(suffix)));
    }
    return filename === pattern;
}
export function shouldBuildForChanges(dockerfilePath, watchFiles, changedFiles) {
    // If no watch_files specified or empty array, always build (default behavior)
    if (!watchFiles || watchFiles.length === 0) {
        return true;
    }
    // Check if any changed file matches the watch patterns
    return changedFiles.some((file) => watchFiles.some((pattern) => matchesPattern(file.filename, pattern)));
}
export function generateImageTag(argObj, branch, timezone, after) {
    const imageTags = [];
    if (argObj.include_branch_name && branch) {
        imageTags.push(branch);
    }
    if (argObj.include_timestamp) {
        const now = new Date();
        const formattedDate = format(toZonedTime(now, timezone), 'yyyyMMddHHmm');
        imageTags.push(formattedDate);
    }
    if (argObj.include_commit_sha) {
        imageTags.push(after);
    }
    return imageTags.join('-');
}
// Validate template variables exist
export function validateTemplateVariables(templates, availableVariables) {
    const variablePattern = /\{(\w+)\}/g;
    const missingVariables = [];
    for (const template of templates) {
        let match;
        while ((match = variablePattern.exec(template)) !== null) {
            const variableName = match[1];
            if (!availableVariables.includes(variableName)) {
                if (!missingVariables.includes(variableName)) {
                    missingVariables.push(variableName);
                }
            }
        }
    }
    if (missingVariables.length > 0) {
        throw new Error(`❌ Invalid template variables found: {${missingVariables.join('}, {')}}\n` +
            `💡 Available variables: {${availableVariables.join('}, {')}}`);
    }
}
// Generate tags from templates
export function generateTagsFromTemplates(templates, variables) {
    return templates.map((template) => {
        let result = template;
        for (const [key, value] of Object.entries(variables)) {
            result = result.replace(new RegExp(`{${key}}`, 'g'), value);
        }
        return result;
    });
}
// Create template variables
export function createTemplateVariables(branch, tag, timezone, sha) {
    const variables = {
        sha: sha.substring(0, 7), // Short SHA
    };
    if (branch) {
        variables.branch = branch;
    }
    if (tag) {
        variables.tag = tag;
    }
    if (timezone) {
        const now = new Date();
        variables.timestamp = format(toZonedTime(now, timezone), 'yyyyMMddHHmm');
    }
    return variables;
}
