
import { getInput, setFailed } from '@actions/core';
import { exec } from '@actions/exec';
import github from '@actions/github';
import { load } from 'js-yaml';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';

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
        imageTags.push(new Date().toISOString());
      }
      if (argObj.with_commit_sha) {
        imageTags.push(after);
      }
      const imageTag = imageTags.join('-');
      const buildArgs = ['build', '-f', argObj.path, '-t', `${argObj.name}:${imageTag}`, '.'];
      await exec('docker', buildArgs);
    }
  }
  // compare.data.files.forEach((f) => {
  //   const file = f.filename
  // });
  // console.log('files: ', files);
  // const dockerfiles = files.filter((file) => {
  //   return argObjs.some((argObj) => argObj.path === file);
  // });
  // console.log('filtered files: ', dockerfiles);



  // for (const dockerfile of dockerfiles) {
  //   const argObj = argObjs.find((argObj) => argObj.path === dockerfile);
  //   console.log('argObj: ', argObj);
  //   const branch = argObj.branch;
  //   const branchName = argObj.with_branch_name ? branch : '';
  //   const timestamp = argObj.with_timestamp ? new Date().toISOString() : '';
  //   const commitSha = argObj.with_commit_sha ? after : '';
  //   console.log('branchName: ', branchName);
  //   console.log('timestamp: ', timestamp);
  //   console.log('commitSha: ', commitSha);
  // }

}

try {
  await main();
} catch (error) {
  setFailed(error.message);
}
