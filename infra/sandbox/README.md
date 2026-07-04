# nabuOS sandbox images (Sprint 4 Epic 4.1)

Hardened base images for gVisor-backed dynamic analysis. Build on a Linux host with Docker.

## Prerequisites

1. [Install gVisor](https://gvisor.dev/docs/user_guide/install/)
2. Register runsc with Docker:

```bash
sudo runsc install
sudo systemctl restart docker   # Linux systemd
```

3. Optional: disable external networking globally per [gVisor networking docs](https://gvisor.dev/docs/user_guide/networking/):

```json
{
  "runtimes": {
    "runsc": {
      "path": "/usr/local/bin/runsc",
      "runtimeArgs": ["--network=none"]
    }
  }
}
```

nabuOS also passes `--network=none` on every `docker run` invocation.

## Build images

```bash
docker build -f node.Dockerfile -t nabuos/sandbox-node:20 .
docker build -f python.Dockerfile -t nabuos/sandbox-python:3.12 .
```

## Verify runsc

```bash
docker run --runtime=runsc --rm hello-world
docker run --runtime=runsc --rm nabuos/sandbox-node:20 node --version
```

## Environment

| Variable | Default |
|----------|---------|
| `NABU_SANDBOX_NODE_IMAGE` | `nabuos/sandbox-node:20` |
| `NABU_SANDBOX_PYTHON_IMAGE` | `nabuos/sandbox-python:3.12` |
| `SANDBOX_RUNTIME` | `runsc` |
