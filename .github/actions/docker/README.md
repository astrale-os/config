# Docker Build and Push Action

Build and push Docker images to GitHub Container Registry (ghcr.io).

## Usage

```yaml
- uses: astrale-os/config/.github/actions/docker@main
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    image-name: kernel
    version: 1.2.3
    build-args: |
      NPM_TOKEN=${{ secrets.NPM_TOKEN }}
      VERSION=1.2.3
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | Yes | | GitHub token with `packages:write` |
| `image-name` | Yes | | Docker image name |
| `version` | Yes | | Image version tag |
| `dockerfile` | No | `Dockerfile` | Path to Dockerfile |
| `context` | No | `.` | Docker build context |
| `build-args` | No | | Build arguments (KEY=VALUE per line) |
| `push` | No | `true` | Push image to registry |

## Outputs

| Output | Description |
|--------|-------------|
| `image` | Full image path with version tag |
| `digest` | Image digest |

## Image Tags

Images are tagged with:
- Version you provide (e.g., `1.2.3`)
- Git SHA short (e.g., `abc1234`)
- `latest`

## Image URL

```
ghcr.io/{owner}/{image-name}:{tag}
```

Example: `ghcr.io/astrale-os/kernel:1.2.3`
