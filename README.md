# URL Shortener

A containerized URL shortener deployed on a local Kubernetes cluster (KinD). This project focuses on DevOps practices. It covers Dockerized services, CI/CD via GitHub Actions, ingress routing, and private registry credential management.

## DevOps Tech Stack

| Layer | Tool / Technology |
|---|---|
| Containerization | ![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white) |
| Orchestration | ![Kubernetes](https://img.shields.io/badge/Kubernetes-326CE5?logo=kubernetes&logoColor=white) via [KinD](https://kind.sigs.k8s.io/) |
| Local LoadBalancer | [`cloud-provider-kind`](https://github.com/kubernetes-sigs/cloud-provider-kind) |
| CI/CD | ![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?logo=github-actions&logoColor=white) |
<!-- | Ingress | ![NGINX](https://img.shields.io/badge/Ingress_NGINX-009639?logo=nginx&logoColor=white) | -->
<!-- | Container Registry | Private registry (`dhi.io`) |
| Secret Management | Kubernetes Secrets (`imagePullSecrets`) |
| Datastore / Cache | ![Redis](https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white) |
| Declarative Config | Kubernetes YAML manifests applied via `kubectl` | -->

<!-- ## Repository Structure

```text
Url-Shortner/
├── app/                     # Application source code
├── nginx/                   # Reverse proxy config
├── redis/                   # Redis config (auth + AOF persistence)
├── k8s/                     # Kubernetes manifests
├── .github/                 # CI: build + push image to Docker Hub on push to main
├── load-tests/              # Load testing
├── compose.yml              # Full stack: nginx + app + postgres + redis
├── .env.example
└── README.md
``` -->

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [KinD](https://kind.sigs.k8s.io/docs/user/quick-start/)
- [Go](https://go.dev/doc/install) required to install `cloud-provider-kind`

## Running on Kubernetes (KinD)

### Step 1: Create a KinD Cluster

```bash
kind create cluster --name url-shortner
```

### Step 2: Install and Run cloud-provider-kind

KinD does not ship with a built-in LoadBalancer. You need `cloud-provider-kind` running in the background for `type: LoadBalancer` services to work on a local KinD cluster.

**Install (requires Go installed on your machine):**

```bash
go install sigs.k8s.io/cloud-provider-kind@latest
```

**Run in a separate terminal:**

On Windows, open the terminal as Administrator before running this command. It needs elevated privileges to manage network interfaces and port mappings.

```bash
cloud-provider-kind
```

Leave this terminal running in the background. It provisions LoadBalancers for your KinD cluster. This allows LoadBalancer typed services to get a reachable external address on your host machine.

### Step 3: Create the Namespace

```bash
kubectl create namespace url-shortner-ns
```

### Step 4: Create the Docker Registry Secret (imagePullSecret)

The application image is hosted on a private registry (`dhi.io`) and requires authentication to pull. You must create a Kubernetes `imagePullSecret`. This allows pods in the `url-shortner-ns` namespace to authenticate with the registry.

> **Definition: imagePullSecret:** A Kubernetes `Secret` of type `docker-registry` that supplies Docker registry credentials to the kubelet. When referenced in a Pod spec via `imagePullSecrets`, it allows Kubernetes to authenticate with a private container registry and pull images on behalf of the pod. Without it, any image requiring authentication will result in `ImagePullBackOff` or `ErrImagePull` errors.

```bash
kubectl create secret docker-registry redis-key \
  --docker-server=dhi.io \
  --docker-username="YOUR_DOCKER_USERNAME" \
  --docker-password="PERSONAL_ACCESS_TOKEN_OR_PASSWORD" \
  --docker-email="YOUR_DOCKER_EMAIL" \
  --namespace=url-shortner-ns
```

> **Note:** In my environment, using a Docker **Personal Access Token (PAT)** as the password did not work for reasons I do not know. I had to use my **Docker account password** directly. If you encounter `ImagePullBackOff` or `401 Unauthorized` errors with a PAT, try using your account password instead.

### Step 5: Apply the Kubernetes Manifests

```bash
kubectl apply -f k8s/
```

This deploys:
- URL Shortener application: `Deployment` and `Service`
- Postgres: `Deployment` and `Service`
- Redis: `Deployment` and `Service`

### Step 6: Verify the Deployment

```bash
kubectl get pods -n url-shortner-ns
kubectl get svc -n url-shortner-ns
```

### Step 7: Delete the KinD Cluster

Once you are done testing, you can clean up your local environment by deleting the KinD cluster.

```bash
kind delete cluster --name url-shortner
```

## CI/CD Pipeline (GitHub Actions)

The GitHub Actions workflow (in `.github/workflows/`) handles:
- Building the Docker image on push to `main`
- Pushing the image to the Docker Hub

<small>The pipeline is intentionally lean while I iterate and learn. See the TODOs below for planned improvements.</small>

## TODO

- 🟡 Split app into frontend and backend microservices ![Docker](https://img.shields.io/badge/Tool-Docker-2496ED?logo=docker&logoColor=white) ![Kubernetes](https://img.shields.io/badge/Tool-Kubernetes-326CE5?logo=kubernetes&logoColor=white)
- 🟡 Implement building and pushing images for frontend and backend via CI ![GitHub Actions](https://img.shields.io/badge/Tool-GitHub_Actions-2088FF?logo=github-actions&logoColor=white)
- 🟡 Shift to PR-based prod branches with CI running tests on PRs before merging to trigger image builds ![GitHub Actions](https://img.shields.io/badge/Tool-GitHub_Actions-2088FF?logo=github-actions&logoColor=white)
- 🟡 Tag images by commit SHA on build using GitHub Actions ![GitHub Actions](https://img.shields.io/badge/Tool-GitHub_Actions-2088FF?logo=github-actions&logoColor=white)
- 🟡 Edit manifest files with the new commit SHA on push ![GitHub Actions](https://img.shields.io/badge/Tool-GitHub_Actions-2088FF?logo=github-actions&logoColor=white)
- 🟡 Enable HPA and VPA using K8s Metrics API ![Kubernetes](https://img.shields.io/badge/Tool-Kubernetes-326CE5?logo=kubernetes&logoColor=white)
- 🟡 Add reverse proxy controller in front of the frontend layer ![NGINX](https://img.shields.io/badge/Tool-NGINX-009639?logo=nginx&logoColor=white)
- 🟡 Add API Gateway (Kong) in front of the backend layer ![Kong](https://img.shields.io/badge/Tool-Kong-003459?logo=kong&logoColor=white)
- 🟡 Implement rate limiting via API gateway using Redis ![Kong](https://img.shields.io/badge/Tool-Kong-003459?logo=kong&logoColor=white) ![Redis](https://img.shields.io/badge/Tool-Redis-DC382D?logo=redis&logoColor=white)
- 🟡 TLS ![Cert-Manager](https://img.shields.io/badge/Tool-Cert_Manager-116466?logo=cert-manager&logoColor=white) ![Kubernetes](https://img.shields.io/badge/Tool-Kubernetes-326CE5?logo=kubernetes&logoColor=white)

## What I Learned

This project is a hands-on DevOps exercise focusing on:
- Containerizing a real application with Docker
- Bootstrapping a local Kubernetes cluster with KinD
- Bridging local clusters and real LoadBalancers via `cloud-provider-kind`
- Deploying and configuring an Ingress controller (Ingress-NGINX) on KinD
- Managing private registry credentials with Kubernetes Secrets (`imagePullSecrets`)
- Writing declarative Kubernetes manifests (Deployments, Services, Ingress)
- Automating image builds with GitHub Actions