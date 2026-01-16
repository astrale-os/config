# Docker Actions

Modular Docker actions for building and pushing images.

## Actions

### `docker/build`
Build Docker image with buildx caching. Does not push.

### `docker/push-ghcr`
Build and push to GitHub Container Registry.

```yaml
- uses: astrale-os/config/.github/actions/docker/push-ghcr@main
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    image-name: kernel
    version: 1.0.0
```

### `docker/push-gar`
Build and push to Google Artifact Registry using Workload Identity Federation.

```yaml
- uses: astrale-os/config/.github/actions/docker/push-gar@main
  with:
    project: astrale-tech-staging
    repository: kernel
    image-name: kernel
    version: 1.0.0
    workload-identity-provider: ${{ secrets.WIF_PROVIDER }}
    service-account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
```

## Outputs

All push actions output:
- `image` - Full image path with version tag
- `digest` - Image digest
