# Docker Build and Push Action

Build once, push to multiple registries. Supports:
- **ghcr.io** (GitHub Container Registry)
- **GAR** (Google Artifact Registry)

## Usage

### Push to ghcr.io only

```yaml
- uses: astrale-os/config/.github/actions/docker@main
  with:
    image-name: kernel
    version: 1.0.0
    ghcr-token: ${{ secrets.GITHUB_TOKEN }}
    build-args: |
      NPM_TOKEN=${{ secrets.NPM_TOKEN }}
```

### Push to GAR only

```yaml
- uses: astrale-os/config/.github/actions/docker@main
  with:
    image-name: kernel
    version: 1.0.0
    gar-project: astrale-tech-staging
    gar-region: europe-west1
    gar-workload-identity-provider: projects/123/locations/global/workloadIdentityPools/github/providers/github
    gar-service-account: github-actions@astrale-tech-staging.iam.gserviceaccount.com
```

### Push to both registries (recommended)

```yaml
- uses: astrale-os/config/.github/actions/docker@main
  with:
    image-name: kernel
    version: 1.0.0
    ghcr-token: ${{ secrets.GITHUB_TOKEN }}
    gar-project: astrale-tech-staging
    gar-region: europe-west1
    gar-workload-identity-provider: ${{ secrets.WIF_PROVIDER }}
    gar-service-account: ${{ secrets.WIF_SERVICE_ACCOUNT }}
    build-args: |
      NPM_TOKEN=${{ secrets.NPM_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `image-name` | Yes | - | Image name (without registry prefix) |
| `version` | Yes | - | Version tag |
| `dockerfile` | No | `Dockerfile` | Path to Dockerfile |
| `context` | No | `.` | Docker build context |
| `build-args` | No | - | Build args (KEY=VALUE, one per line) |
| `push` | No | `true` | Push to registry |
| `ghcr-token` | No | - | GitHub token (enables ghcr.io) |
| `gar-project` | No | - | GCP project ID (enables GAR) |
| `gar-region` | No | `europe-west1` | GAR region |
| `gar-workload-identity-provider` | No | - | WIF provider for GAR auth |
| `gar-service-account` | No | - | Service account for GAR auth |

## Outputs

| Output | Description |
|--------|-------------|
| `ghcr-image` | Full ghcr.io image:tag |
| `gar-image` | Full GAR image:tag |
| `digest` | Image digest |

## How it works

1. Authenticates to enabled registries (ghcr.io and/or GAR)
2. Builds image **once** with Docker Buildx
3. Pushes to **all enabled registries** in single operation
4. Uses GitHub Actions cache for layers
