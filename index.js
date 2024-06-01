
import { getInput, setFailed } from '@actions/core';
import { exec } from '@actions/exec';
import github from '@actions/github';
import { load } from 'js-yaml';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';
import { format } from 'date-fns';

const schema = z.object({
  path: z.string(),
  name: z.string(),
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


  for (const argObj of argObjs) {
    let buildRequired = false;
    if (argObj.only_changed) {
      const dockerfile = compare.data.files.find((file) => file.filename === argObj.path);
      if (dockerfile) {
        buildRequired = true;
      }
    } else {
      buildRequired = true;
    }
    if (buildRequired) {
      const imageTags = []
      if (argObj.with_branch_name) {
        imageTags.push(argObj.branch);
      }
      if (argObj.with_timestamp) {
        const now = new Date();
        const formattedDate = format(now, 'yyyyMMddHHmm');
        imageTags.push(formattedDate);
      }
      if (argObj.with_commit_sha) {
        imageTags.push(after);
      }
      const imageTag = imageTags.join('-');
      const buildArgs = ['build', '-f', argObj.path, '-t', `${argObj.name}:${imageTag}`, '.'];
      console.log('Current directory:', process.cwd());
    }
  }

}

try {
  await main();
} catch (error) {
  setFailed(error.message);
}
