# Docker Actions

Modular Docker actions for building, pushing, and copying images.

## Actions

### `docker/build`
Build Docker image with buildx caching. Does not push.

### `docker/push-gar`
Build and push to Google Artifact Registry using Workload Identity Federation.

```yaml
- uses: astrale-os/config/.github/actions/docker/push-gar@main
  id: gar
  with:
    project: astrale-tech-staging
    repository: kernel
    image-name: kernel
    version: 1.0.0
    workload-identity-provider: ${{ secrets.WIF_PROVIDER }}
    service-account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
```

### `docker/push-ghcr`
Build and push to GitHub Container Registry.

```yaml
- uses: astrale-os/config/.github/actions/docker/push-ghcr@main
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    image-name: kernel
    version: 1.0.0
```

### `docker/copy`
Copy image between registries using crane (no rebuild, very fast).

```yaml
- uses: astrale-os/config/.github/actions/docker/copy@main
  with:
    source: europe-west1-docker.pkg.dev/project/repo/image:1.0.0
    destination: ghcr.io/org/image:1.0.0
    dest-registry: ghcr.io
    dest-username: ${{ github.actor }}
    dest-password: ${{ secrets.GITHUB_TOKEN }}
```

## Multi-Registry Pattern

Build once, push to multiple registries efficiently:

```yaml
jobs:
  docker:
    steps:
      # 1. Build and push to primary registry (GAR)
      - uses: astrale-os/config/.github/actions/docker/push-gar@main
        id: gar
        with:
          project: astrale-tech-staging
          repository: kernel
          image-name: kernel
          version: ${{ steps.version.outputs.version }}
          workload-identity-provider: ${{ secrets.WIF_PROVIDER }}
          service-account: ${{ secrets.GCP_SERVICE_ACCOUNT }}

      # 2. Copy to secondary registry (ghcr.io) - no rebuild!
      - uses: astrale-os/config/.github/actions/docker/copy@main
        with:
          source: ${{ steps.gar.outputs.image }}
          destination: ghcr.io/astrale-os/kernel:${{ steps.version.outputs.version }}
          source-registry: europe-west1-docker.pkg.dev
          source-username: oauth2accesstoken
          source-password: ${{ steps.gar.outputs.token }}
          dest-registry: ghcr.io
          dest-username: ${{ github.actor }}
          dest-password: ${{ secrets.GITHUB_TOKEN }}
```

## Outputs

Push actions output:
- `image` - Full image path with version tag
- `digest` - Image digest
