
import { getInput, setFailed } from '@actions/core';
import github from '@actions/github';
import { load } from 'js-yaml';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';

const schema = z.object({
  path: z.string(),
  branch: z.string(),
  only_changed: z.boolean().optional().default(true),
  with_branch_name: z.boolean().optional().default(true),
  with_timestamp: z.boolean().optional().default(true),
  with_commit_sha: z.boolean().optional().default(true),
});

async function main() {
  const token = getInput('token');
  const args = load(getInput('args'));
  const argObjs = []
  for (const arg of args) {
    argObjs.push(schema.parse(arg));
  }
  console.log(argObjs);

  const octokit = new Octokit({ auth: token });
  const { repository, after } = github.context.payload;

  const compare = await octokit.repos.compareCommits({
    owner: repository.owner.login,
    repo: repository.name,
    base: after + '^',
    head: after,
  });

  const files = compare.data.files.map((file) => file.filename);
  console.log('files: ', files);
}

try {
  await main();
} catch (error) {
  setFailed(error.message);
}
