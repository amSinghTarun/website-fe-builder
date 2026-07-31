#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

# ==========================================
# CONFIGURATION - Change these values
# ==========================================
K8S_SA_NAME="agent-k8s-sa"
K8S_NAMESPACE="default"

GCP_PROJECT_ID="YOUR_GCP_PROJECT_ID"
GCP_SA_EMAIL="YOUR_GCP_SERVICE_ACCOUNT@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
# ==========================================

echo "=================================================="
echo "Starting Workload Identity Setup"
echo "=================================================="

# 1. Create the Service Account in Kubernetes
echo "⏳ Step 1: Creating Kubernetes Service Account '${K8S_SA_NAME}' in namespace '${K8S_NAMESPACE}'..."

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${K8S_SA_NAME}
  namespace: ${K8S_NAMESPACE}
EOF

echo "✅ Kubernetes Service Account created successfully."
echo "--------------------------------------------------"

# 2. Bind it to your GCP Service Account
echo "⏳ Step 2: Binding K8S Identity to GCP Service Account..."
echo "Target GCP SA: ${GCP_SA_EMAIL}"

gcloud iam service-accounts add-iam-policy-binding "${GCP_SA_EMAIL}" \
    --role="roles/iam.workloadIdentityUser" \
    --member="serviceAccount:${GCP_PROJECT_ID}.svc.id.goog[${K8S_NAMESPACE}/${K8S_SA_NAME}]"

echo "--------------------------------------------------"
echo "🎉 Setup complete! Your Kubernetes pods using the"
echo "   '${K8S_SA_NAME}' service account can now securely"
echo "   authenticate with Google Cloud."
echo "=================================================="


# EXPLAINATION: 

# Kubernetes proactively injects it.
# When you deploy your pod with serviceAccountName: "agent-k8s-sa", the Kubernetes control plane sees this before the pod even starts.
# The control plane automatically mounts a special, short-lived OIDC JSON Web Token (JWT) into the pod's file system at a projected volume path (typically /var/run/secrets/kubernetes.io/serviceaccount/token).
# Simultaneously, because GKE knows you are using Workload Identity, it injects environment variables into your container automatically, such as:
# GOOGLE_APPLICATION_CREDENTIALS pointing to a local configuration file.