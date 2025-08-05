import { Octokit } from '@octokit/rest';
interface ProjectConfig {
    imageTagsOnTagPushed: string[] | null;
    imageTagsOnBranchPushed: string[] | null;
    imageTagsOnPullRequest: string[] | null;
    watchFiles: string[];
}
interface DockerfileConfig {
    imageName?: string;
    imageTagsOnTagPushed?: string[] | null;
    imageTagsOnBranchPushed?: string[] | null;
    imageTagsOnPullRequest?: string[] | null;
    watchFiles?: string[];
}
interface ActionResult {
    dockerfilePath: string;
    imageName: string;
    imageTag: string;
}
interface TemplateVariables {
    tag?: string;
    branch?: string;
    sha?: string;
    timestamp?: string;
    pr_number?: string;
}
interface GitRef {
    branch: string | null;
    tag: string | null;
}
interface GitHubContext {
    payload: {
        repository?: {
            name: string;
            owner: {
                login: string;
            };
        };
        before?: string;
        after?: string;
        ref?: string;
        pull_request?: {
            number: number;
            head?: {
                sha: string;
                ref: string;
            };
            [key: string]: any;
        };
    };
    eventName?: string;
    event_name?: string;
}
export declare function generateBuildArgs(token: string, timezone: string, githubContext: GitHubContext, workingDir: string): Promise<ActionResult[]>;
export declare function loadProjectConfig(workingDir: string): ProjectConfig;
export declare function findDockerfiles(workingDir: string): string[];
export declare function extractDockerfileConfig(dockerfilePath: string, workingDir: string): DockerfileConfig;
export declare function getRepositoryChanges(octokit: Octokit, repository: {
    owner: {
        login: string;
    };
    name: string;
}, before: string, after: string): Promise<import("@octokit/types").OctokitResponse<{
    url: string;
    html_url: string;
    permalink_url: string;
    diff_url: string;
    patch_url: string;
    base_commit: import("@octokit/openapi-types").components["schemas"]["commit"];
    merge_base_commit: import("@octokit/openapi-types").components["schemas"]["commit"];
    status: "diverged" | "ahead" | "behind" | "identical";
    ahead_by: number;
    behind_by: number;
    total_commits: number;
    commits: import("@octokit/openapi-types").components["schemas"]["commit"][];
    files?: import("@octokit/openapi-types").components["schemas"]["diff-entry"][];
}, 200>>;
export declare function checkImageTagExists(octokit: Octokit, imageName: string, tag: string): Promise<boolean>;
export declare function ensureUniqueTag(tags: string[], templateVariables: TemplateVariables, octokit: Octokit, imageName: string, allowOverwrite?: boolean): Promise<void>;
export declare function parseGitRef(ref: string): GitRef;
export declare function isBuildRequired(watchFiles: string[], changedFiles: {
    filename: string;
}[]): boolean;
export declare function validateTemplateVariables(templates: string[], availableVariables: string[]): void;
export declare function generateTags(templates: string[], variables: TemplateVariables): string[];
export declare function createTemplateVariables(branch: string | null, tag: string | null, timezone: string, sha: string, prNumber?: number | null): TemplateVariables;
export {};
