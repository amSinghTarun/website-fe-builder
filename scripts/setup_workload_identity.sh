#!/usr/bin/env bash
set -e

# ==========================================
# CONFIGURATION - Change these values
# ==========================================
K8S_SA_NAME="k8s-service-account"
K8S_NAMESPACE="default"

GCP_PROJECT_ID="project-b955da7b-8f9e-4324-af2"
BACKUP_BUCKET="lovable_backup_snapshots"
# ==========================================

echo "=================================================="
echo "Starting Workload Identity Setup"
echo "=================================================="

# 1. Create the Service Account in Kubernetes
echo "Step 1: Creating Kubernetes Service Account '${K8S_SA_NAME}' in namespace '${K8S_NAMESPACE}'..."

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${K8S_SA_NAME}
  namespace: ${K8S_NAMESPACE}
EOF

echo "Kubernetes Service Account created successfully."
echo "--------------------------------------------------"

# 2. Grant the direct GKE workload principal only the cloud permissions used
# by the agent and recovery services.
echo "Step 2: Granting cloud roles to the GKE workload principal..."

PROJECT_NUMBER="$(gcloud projects describe "${GCP_PROJECT_ID}" --format='value(projectNumber)')"
WORKLOAD_PRINCIPAL="principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${GCP_PROJECT_ID}.svc.id.goog/subject/ns/${K8S_NAMESPACE}/sa/${K8S_SA_NAME}"

gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
    --role="roles/aiplatform.user" \
    --member="${WORKLOAD_PRINCIPAL}" \
    --condition=None

gcloud storage buckets add-iam-policy-binding "gs://${BACKUP_BUCKET}" \
    --role="roles/storage.objectAdmin" \
    --member="${WORKLOAD_PRINCIPAL}"

gcloud storage buckets add-iam-policy-binding "gs://${BACKUP_BUCKET}" \
    --role="roles/storage.legacyBucketReader" \
    --member="${WORKLOAD_PRINCIPAL}"

echo "--------------------------------------------------"
echo "Setup complete. Pods using '${K8S_SA_NAME}' can now call Vertex AI"
echo "and read/write the configured backup bucket."
echo "=================================================="


# EXPLANATION:

# Kubernetes proactively injects it.
# When you deploy your pod with serviceAccountName: "agent-k8s-sa", the Kubernetes control plane sees this before the pod even starts.
# The control plane automatically mounts a special, short-lived OIDC JSON Web Token (JWT) into the pod's file system at a projected volume path (typically /var/run/secrets/kubernetes.io/serviceaccount/token).
# GKE's metadata server exchanges that projected identity for short-lived
# Google credentials. No service-account key or static credential file is
# embedded in the container.
