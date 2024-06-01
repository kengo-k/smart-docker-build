# Docker Image Builder

This GitHub Action automatically builds Docker images and pushes them to the GitHub Container Registry (GHCR) whenever a Dockerfile is committed to a repository and a branch or tag is pushed.

## Usage

To use this action in your workflow, add the following step to your `.github/workflows/main.yml` file:

```yaml
name: 'Test to publish Docker image'
on:
  push:
    branches:
      - main
    tags:
      - '*'

jobs:
  test:
    runs-on: ubuntu-22.04
    steps:
      - name: 'Test'
        uses: kengo-k/docker-build@v1
        with:
          token: ${{ secrets.GHCR_TOKEN }}
          timezone: 'Asia/Tokyo'
          args: |
            - path: .github/workflows/Dockerfile
              name: helloworld
              on_branch_pushed: true
              on_branch_changed: true
              on_tag_pushed: true
              include_branch_name: true
              include_timestamp: true
              include_commit_sha: true
```

### Input Arguments

- `token` (required): A token with permissions to access the GitHub repository information and push images to GHCR.
- `timezone` (optional): The timezone used for generating timestamps in the image tags. Default is UTC.
- `args` (required): An array of objects specifying the configuration values for building Dockerfiles. Each object should contain the following properties:
  - `path` (required): The path to the Dockerfile.
  - `name` (required): The name of the built image.
  - `on_branch_pushed` (optional): Whether to build the image when a branch is pushed. Default is `true`.
  - `on_branch_changed` (optional): If `on_branch_pushed` is `true`, only build the image if the Dockerfile is included in the commit. Default is `true`.
  - `on_tag_pushed` (optional): Whether to build the image when a tag is pushed. Default is `true`.
  - `include_branch_name` (optional): Whether to include the branch name in the image tag when a branch is pushed. Default is `true`.
  - `include_timestamp` (optional): Whether to include a timestamp in the image tag when a branch is pushed. Default is `true`.
  - `include_commit_sha` (optional): Whether to include the commit ID in the image tag when a branch is pushed. Default is `true`.

## How It Works

When a branch or tag is pushed to the repository, this action will:

1. Check if a Dockerfile is present in the repository based on the provided `path` in the `args` configuration.
2. If `on_branch_pushed` is `true` and the push event is for a branch, build the Docker image.
3. If `on_branch_changed` is `true`, only build the image if the Dockerfile is included in the commit.
4. If `on_tag_pushed` is `true` and the push event is for a tag, build the Docker image.
5. Generate an image tag based on the specified options (`include_branch_name`, `include_timestamp`, `include_commit_sha`).
6. Build the Docker image using the provided Dockerfile and image name.
7. Push the built image to the GitHub Container Registry (GHCR) using the generated tag.

This action simplifies the process of building and pushing Docker images to GHCR, making it easier to automate your container deployment workflow.
