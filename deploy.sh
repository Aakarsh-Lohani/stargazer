#!/bin/bash
# ──────────────────────────────────────────────
# StarGazer — Cloud Run Deployment Script
# ──────────────────────────────────────────────
set -euo pipefail

# Configuration
export PROJECT_ID=${PROJECT_ID:-$(gcloud config get project)}
export REGION=${REGION:-us-central1}
export SERVICE_NAME=${SERVICE_NAME:-stargazer}
export SA_NAME=${SA_NAME:-stargazer-sa}
export SERVICE_ACCOUNT="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
export IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "🌌 StarGazer Deployment"
echo "═══════════════════════════════════════"
echo "  Project:  ${PROJECT_ID}"
echo "  Region:   ${REGION}"
echo "  Service:  ${SERVICE_NAME}"
echo "  SA:       ${SERVICE_ACCOUNT}"
echo "═══════════════════════════════════════"

# Step 1: Build the container image
echo ""
echo "📦 Building container image..."
gcloud builds submit --tag "${IMAGE}" .

# Step 2: Deploy to Cloud Run
echo ""
echo "🚀 Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --platform=managed \
  --service-account="${SERVICE_ACCOUNT}" \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --timeout=300 \
  --set-env-vars="GOOGLE_GENAI_USE_VERTEXAI=1,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},MODEL=gemini-2.0-flash" \
  --set-secrets="OPENWEATHER_API_KEY=openweather-api-key:latest,MAPS_API_KEY=maps-api-key:latest,N2YO_API_KEY=n2yo-api-key:latest,NASA_API_KEY=nasa-api-key:latest,GOOGLE_CALENDAR_REFRESH_TOKEN=calendar-refresh-token:latest,GOOGLE_OAUTH_CLIENT_ID=google-oauth-client-id:latest,GOOGLE_OAUTH_CLIENT_SECRET=google-oauth-client-secret:latest,CALENDAR_ID=calendar-id:latest" \
  # NOTE: Remove the Calendar secrets above (last 4) if you skipped Calendar OAuth setup.
  --labels="project=stargazer"

# Step 3: Get the deployed URL
echo ""
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "═══════════════════════════════════════"
echo "✅ StarGazer is LIVE!"
echo "🌐 URL: ${SERVICE_URL}"
echo "═══════════════════════════════════════"
